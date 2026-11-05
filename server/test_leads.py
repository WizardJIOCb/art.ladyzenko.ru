import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from leads import Handler, InvalidLead, ORIGIN, Outbox, ThreadingHTTPServer


class LeadsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = {'bot_token': 'test', 'recipients': [
            {'username': 'first', 'chat_id': '1'}, {'username': 'second', 'chat_id': '2'}]}
        self.sent = []
        def transport(recipient, text):
            self.sent.append((recipient['username'], text))
            return {'status': 'sent', 'message_id': len(self.sent)}
        self.box = Outbox(Path(self.tmp.name) / 'leads.db', self.config, transport)
        self.lead = {'name': 'Тест', 'contact': 'test@example.com', 'source': '/new2/',
                     'request_id': 'test-request-id-0001', 'message': '<b>Plain text</b>'}

    def tearDown(self):
        self.tmp.cleanup()

    def test_persist_and_send_both_only_once(self):
        first = self.box.accept(self.lead, '127.0.0.1')
        self.assertEqual(first, self.box.accept(self.lead, '127.0.0.1'))
        self.box.deliver()
        self.box.deliver()
        self.assertEqual(['first', 'second'], [item[0] for item in self.sent])
        self.assertIn('test@example.com', self.sent[0][1])
        self.assertIn('/new2/', self.sent[0][1])
        self.assertEqual({'sent': 2}, self.box.health()['deliveries'])

    def test_changed_payload_cannot_reuse_request_id(self):
        self.box.accept(self.lead, '127.0.0.1')
        with self.assertRaises(InvalidLead):
            self.box.accept({**self.lead, 'name': 'Изменено'}, '127.0.0.1')

    def test_validation_and_rate_limit(self):
        for change in [{'name': ''}, {'contact': 'bad'}, {'message': 'x' * 2001}]:
            with self.assertRaises(InvalidLead):
                self.box.accept({**self.lead, **change}, 'ip')
        for n in range(5):
            self.box.accept({**self.lead, 'request_id': f'test-request-id-{n:04}'}, 'ip')
        with self.assertRaises(OverflowError):
            self.box.accept({**self.lead, 'request_id': 'test-request-id-0099'}, 'ip')

    def test_uncertain_send_is_never_blindly_retried(self):
        self.box.transport = lambda recipient, text: {'status': 'uncertain'}
        self.box.accept(self.lead, 'ip')
        self.box.deliver()
        self.assertEqual({'uncertain': 2}, self.box.health()['deliveries'])
        self.box.transport = lambda recipient, text: self.fail('Uncertain message must not resend')
        self.box.deliver()

    def test_retry_does_not_resend_successful_recipient(self):
        attempts = []
        def transport(recipient, text):
            attempts.append(recipient['username'])
            return {'status': 'sent', 'message_id': 1} if recipient['username'] == 'first' else {'status': 'pending'}
        self.box.transport = transport
        self.box.accept(self.lead, 'ip')
        self.box.deliver()
        with self.box.db() as db:
            db.execute('UPDATE deliveries SET next_attempt=0')
        self.box.deliver()
        self.assertEqual(['first', 'second', 'second'], attempts)

    def test_restart_marks_inflight_as_uncertain(self):
        self.box.accept(self.lead, 'ip')
        with self.box.db() as db:
            db.execute("UPDATE deliveries SET status='sending'")
        restored = Outbox(self.box.path, self.config)
        self.assertEqual({'uncertain': 2}, restored.health()['deliveries'])

    def test_http_origin_honeypot_and_acceptance(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.outbox = self.box
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}/api/leads'
        def send(data, origin=ORIGIN):
            request = Request(url, json.dumps(data).encode(), headers={'Content-Type': 'application/json', 'Origin': origin})
            try:
                with urlopen(request) as response:
                    return response.status, json.load(response)
            except HTTPError as error:
                return error.code, json.loads(error.read())
        try:
            self.assertEqual(403, send(self.lead, 'https://other.invalid')[0])
            self.assertEqual(400, send({**self.lead, 'name': ''})[0])
            self.assertEqual(202, send({**self.lead, 'website': 'spam'})[0])
            self.assertEqual({}, self.box.health()['deliveries'])
            self.assertEqual(202, send(self.lead)[0])
            self.assertEqual({'pending': 2}, self.box.health()['deliveries'])
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
