"""Small durable outbox for art.ladyzenko.ru. Python standard library only."""
import hashlib
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs
from urllib.request import Request, urlopen
import uuid

ORIGIN = 'https://art.ladyzenko.ru'
PAGES = {'/': 'Основная версия', '/new/': 'Предыдущая версия', '/new2/': 'Версия с анимацией'}


class InvalidLead(ValueError):
    pass


def normalize(data):
    def field(key, limit, fallback=''):
        value = data.get(key, fallback)
        if not isinstance(value, str) or len(value) > limit:
            raise InvalidLead('Проверьте заполнение формы.')
        return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', value).strip()
    name = field('name', 100)
    contact = field('contact', 180, data.get('phone', ''))
    if len(name) < 2:
        raise InvalidLead('Укажите ваше имя.')
    digits = re.sub(r'\D', '', contact)
    if not (10 <= len(digits) <= 15 or re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', contact)
            or re.fullmatch(r'@[A-Za-z0-9_]{5,32}', contact)):
        raise InvalidLead('Укажите телефон, почту или Telegram для связи.')
    source = field('source', 30, '/')
    if source not in PAGES:
        source = '/'
    return {'name': name, 'contact': contact, 'course': field('course', 180, data.get('direction', '')),
            'message': field('message', 2000, data.get('comment', '')), 'source': source}


class Outbox:
    def __init__(self, path, config, transport=None):
        self.path = str(path)
        self.config = config
        self.transport = transport or self.telegram
        self.lock = threading.Lock()
        self.wake = threading.Event()
        with self.db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS leads (
                    id TEXT PRIMARY KEY, payload TEXT NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS deliveries (
                    lead_id TEXT NOT NULL, recipient TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
                    attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0,
                    message_id INTEGER, error TEXT, PRIMARY KEY (lead_id, recipient));
                CREATE TABLE IF NOT EXISTS requests (ip TEXT NOT NULL, created REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS request_time ON requests(created);
            ''')
            # A crash during send is ambiguous; never silently send that message twice.
            db.execute("UPDATE deliveries SET status='uncertain' WHERE status='sending'")

    @contextmanager
    def db(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def ready(self):
        return bool(self.config.get('bot_token') and len(self.config.get('recipients', [])) == 2
                    and all(r.get('chat_id') for r in self.config['recipients']))

    def accept(self, data, ip):
        if not self.ready():
            raise RuntimeError('Telegram is not configured')
        lead = normalize(data)
        request_id = data.get('request_id') or str(uuid.uuid4())
        if not isinstance(request_id, str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', request_id):
            raise InvalidLead('Обновите страницу и повторите отправку.')
        payload = json.dumps(lead, ensure_ascii=False, sort_keys=True)
        with self.lock, self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT payload FROM leads WHERE id=?', (request_id,)).fetchone()
            if previous:
                if previous['payload'] != payload:
                    raise InvalidLead('Данные заявки изменились. Повторите отправку.')
                return request_id
            now = time.time()
            ip_hash = hashlib.sha256(ip.encode()).hexdigest()
            db.execute('DELETE FROM requests WHERE created < ?', (now - 600,))
            if db.execute('SELECT COUNT(*) FROM requests WHERE ip=?', (ip_hash,)).fetchone()[0] >= 5:
                raise OverflowError('Слишком много заявок. Попробуйте позже или свяжитесь напрямую.')
            if db.execute('SELECT COUNT(*) FROM requests').fetchone()[0] >= 100:
                raise OverflowError('Попробуйте немного позже или свяжитесь напрямую.')
            db.execute('INSERT INTO requests VALUES (?,?)', (ip_hash, now))
            db.execute('INSERT INTO leads VALUES (?,?,?)', (request_id, payload, now))
            for recipient in self.config['recipients']:
                db.execute('INSERT INTO deliveries (lead_id,recipient) VALUES (?,?)',
                           (request_id, recipient['username']))
        self.wake.set()
        return request_id

    def telegram(self, recipient, text):
        url = 'https://api.telegram.org/bot' + self.config['bot_token'] + '/sendMessage'
        body = json.dumps({'chat_id': recipient['chat_id'], 'text': text,
                           'link_preview_options': {'is_disabled': True}}).encode()
        request = Request(url, data=body, headers={'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=15) as response:
                result = json.load(response)
        except HTTPError as error:
            try:
                result = json.loads(error.read())
            except (ValueError, UnicodeError):
                # A non-JSON proxy/server response cannot prove whether it was delivered.
                return {'status': 'uncertain', 'error': 'Ambiguous HTTP response'}
        except (URLError, TimeoutError, OSError):
            return {'status': 'uncertain', 'error': 'Ambiguous network outcome'}
        except (ValueError, UnicodeError):
            return {'status': 'uncertain', 'error': 'Ambiguous Telegram response'}
        if result.get('ok'):
            return {'status': 'sent', 'message_id': result['result']['message_id']}
        code = result.get('error_code', 0)
        return {'status': 'pending' if code == 429 or code >= 500 else 'failed',
                'error': 'Telegram API error ' + str(code),
                'retry_after': max(10, int(result.get('parameters', {}).get('retry_after', 30)))}

    def deliver(self):
        with self.db() as db:
            rows = db.execute('''SELECT d.*, l.payload FROM deliveries d JOIN leads l ON l.id=d.lead_id
                WHERE d.status='pending' AND d.next_attempt <= ? ORDER BY l.created LIMIT 10''',
                              (time.time(),)).fetchall()
        recipients = {r['username']: r for r in self.config['recipients']}
        for row in rows:
            with self.db() as db:
                claimed = db.execute("UPDATE deliveries SET status='sending',attempts=attempts+1 WHERE lead_id=? AND recipient=? AND status='pending'",
                                     (row['lead_id'], row['recipient'])).rowcount
            if not claimed:
                continue
            lead = json.loads(row['payload'])
            text = ('Новая заявка · Мастерская Анны\n\n' + 'Имя: ' + lead['name'] + '\nСвязаться: ' + lead['contact']
                    + '\nНаправление: ' + (lead['course'] or 'Помочь выбрать')
                    + '\nКомментарий: ' + (lead['message'] or '—')
                    + '\n\nСтраница: ' + ORIGIN + lead['source'] + '\nЗаявка: ' + row['lead_id'])
            try:
                result = self.transport(recipients[row['recipient']], text)
            except Exception:
                result = {'status': 'uncertain', 'error': 'Unexpected transport failure'}
            if result['status'] == 'pending' and row['attempts'] >= 7:
                result['status'] = 'failed'
            delay = max(result.get('retry_after', 30), min(3600, 30 * 2 ** row['attempts']))
            with self.db() as db:
                db.execute('''UPDATE deliveries SET status=?, next_attempt=?, message_id=?,error=?
                    WHERE lead_id=? AND recipient=?''',
                           (result['status'], time.time() + delay, result.get('message_id'),
                            result.get('error'), row['lead_id'], row['recipient']))
            print(json.dumps({'event': 'lead_delivery', 'id': row['lead_id'],
                              'recipient': row['recipient'], 'status': result['status']}), flush=True)

    def health(self):
        with self.db() as db:
            counts = dict(db.execute('SELECT status,COUNT(*) FROM deliveries GROUP BY status').fetchall())
        return {'ok': self.ready(), 'deliveries': counts}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def reply(self, status, value):
        raw = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == '/healthz':
            self.reply(200, self.server.outbox.health())
        else:
            self.reply(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path != '/api/leads':
            return self.reply(404, {'error': 'Not found'})
        if self.headers.get('Origin') != ORIGIN:
            return self.reply(403, {'error': 'Откройте форму на сайте мастерской.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 12_000:
                return self.reply(413, {'error': 'Заявка слишком большая.'})
            raw = self.rfile.read(size).decode('utf-8')
            content_type = self.headers.get('Content-Type', '').split(';')[0]
            if content_type == 'application/json':
                data = json.loads(raw)
            elif content_type == 'application/x-www-form-urlencoded':
                data = {k: v[-1] for k, v in parse_qs(raw, keep_blank_values=True).items()}
            else:
                return self.reply(415, {'error': 'Неподдерживаемый формат заявки.'})
            if not isinstance(data, dict):
                raise ValueError()
            if data.get('website'):
                return self.reply(202, {'ok': True})
            request_id = self.server.outbox.accept(data, self.headers.get('X-Real-IP', self.client_address[0]))
            self.reply(202, {'ok': True, 'id': request_id, 'message': 'Заявка получена. Мы свяжемся с вами.'})
        except InvalidLead as error:
            self.reply(400, {'error': str(error)})
        except OverflowError as error:
            self.reply(429, {'error': str(error)})
        except (ValueError, UnicodeError):
            self.reply(400, {'error': 'Проверьте данные и повторите отправку.'})
        except Exception:
            self.reply(503, {'error': 'Не удалось принять заявку. Попробуйте ещё раз или напишите в Telegram.'})


def main():
    os.umask(0o077)
    credentials = Path(os.environ.get('CREDENTIALS_DIRECTORY', '/etc'))
    config_path = Path(os.environ.get('ART_LEADS_CONFIG', str(credentials / 'art-leads.json')))
    config = json.loads(config_path.read_text())
    state = Path(os.environ.get('STATE_DIRECTORY', '/var/lib/art-ladyzenko-leads'))
    state.mkdir(parents=True, exist_ok=True)
    outbox = Outbox(state / 'leads.sqlite3', config)
    if not outbox.ready():
        raise RuntimeError('Configure bot and both recipients before starting')
    def worker():
        while True:
            try:
                outbox.deliver()
            except Exception:
                print('Delivery worker database error', flush=True)
            outbox.wake.wait(timeout=2)
            outbox.wake.clear()
    threading.Thread(target=worker, daemon=True).start()
    server = ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('PORT', '8330'))), Handler)
    server.outbox = outbox
    server.serve_forever()


if __name__ == '__main__':
    main()
