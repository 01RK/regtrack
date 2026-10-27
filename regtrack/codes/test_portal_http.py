"""Real local TLS handshakes and CATARC transport contract tests (no internet)."""
from contextlib import contextmanager, redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import os
from pathlib import Path
import ssl
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch

import requests
import trustme
import truststore

from catarc_portal import BASE, Portal
from constants import APP_VERSION
from portal_http import create_session, SystemTrustAdapter
import check_catarc


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'verified TLS')

    def log_message(self, *args):
        pass


@contextmanager
def tls_server(certificate):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    certificate.configure_cert(context)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_port
    finally:
        server.shutdown()
        server.server_close()
        thread.join(5)


class PortalHTTPTest(unittest.TestCase):
    def test_real_tls_with_it_provided_ca_bundle(self):
        ca = trustme.CA()
        with tempfile.TemporaryDirectory() as tmp, tls_server(ca.issue_cert('localhost')) as port:
            bundle = Path(tmp) / 'enterprise.pem'
            ca.cert_pem.write_to_path(bundle)
            with patch.dict(os.environ, {'REQUESTS_CA_BUNDLE': str(bundle), 'NO_PROXY': '*'}):
                with create_session() as session:
                    response = session.get(f'https://localhost:{port}', timeout=3)
                    self.assertEqual(response.content, b'verified TLS')
                    self.assertTrue(session.verify)

    @unittest.skipUnless(os.name == 'posix', 'Linux/OpenSSL native-store environment test')
    def test_native_system_store_succeeds_where_default_requests_fails(self):
        ca = trustme.CA()
        with tempfile.TemporaryDirectory() as tmp, tls_server(ca.issue_cert('localhost')) as port:
            bundle = Path(tmp) / 'system-roots.pem'
            ca.cert_pem.write_to_path(bundle)
            env = {'SSL_CERT_FILE': str(bundle), 'NO_PROXY': '*'}
            # Remove unrelated custom bundles for a genuine native-store comparison.
            with patch.dict(os.environ, env):
                with patch.dict(os.environ):
                    os.environ.pop('REQUESTS_CA_BUNDLE', None)
                    os.environ.pop('CURL_CA_BUNDLE', None)
                    with self.assertRaises(requests.exceptions.SSLError):
                        requests.get(f'https://localhost:{port}', timeout=3)
                    with create_session() as session:
                        self.assertEqual(session.get(f'https://localhost:{port}', timeout=3).status_code, 200)

    def test_untrusted_chain_is_still_rejected(self):
        ca = trustme.CA()
        with tls_server(ca.issue_cert('localhost')) as port, create_session() as session:
            session.trust_env = False
            with self.assertRaises(requests.exceptions.SSLError):
                session.get(f'https://localhost:{port}', timeout=3)

    def test_wrong_hostname_is_still_rejected(self):
        ca = trustme.CA()
        with tempfile.TemporaryDirectory() as tmp, tls_server(ca.issue_cert('wrong.example')) as port:
            bundle = Path(tmp) / 'enterprise.pem'
            ca.cert_pem.write_to_path(bundle)
            with create_session() as session:
                session.trust_env = False
                with self.assertRaises(requests.exceptions.SSLError):
                    session.get(f'https://localhost:{port}', verify=str(bundle), timeout=3)

    def test_disabling_verification_is_rejected(self):
        with create_session() as session:
            with self.assertRaisesRegex(ValueError, 'cannot be disabled'):
                session.get(BASE, verify=False, timeout=1)

    def test_proxy_and_custom_bundle_settings_preserved(self):
        with create_session() as session, patch.dict(os.environ, {
                'HTTPS_PROXY': 'http://proxy.example:8080', 'NO_PROXY': '',
                'REQUESTS_CA_BUNDLE': '/it/roots.pem'}, clear=True):
            settings = session.merge_environment_settings(BASE, {}, None, None, None)
            self.assertEqual(settings['proxies']['https'], 'http://proxy.example:8080')
            self.assertEqual(settings['verify'], '/it/roots.pem')
            adapter = session.get_adapter(BASE)
            self.assertIsInstance(adapter.ssl_context, truststore.SSLContext)
            prepared = requests.Request('GET', BASE).prepare()
            _, options = adapter.build_connection_pool_key_attributes(prepared, '/it/roots.pem')
            self.assertIs(options['ssl_context'], adapter.ssl_context)
            self.assertEqual(options['ca_certs'], '/it/roots.pem')
            self.assertEqual(options['cert_reqs'], 'CERT_REQUIRED')

    def test_no_global_ssl_patch(self):
        original = ssl.SSLContext
        with create_session():
            self.assertIs(ssl.SSLContext, original)

    def test_portal_uses_transport_and_current_version(self):
        portal = Portal()
        self.addCleanup(portal.close)
        self.assertIsInstance(portal.session.get_adapter(BASE), SystemTrustAdapter)
        self.assertIn(APP_VERSION, portal.session.headers['User-Agent'])

    def test_certificate_failure_is_actionable_and_not_retried(self):
        portal = Portal()
        self.addCleanup(portal.close)
        original = requests.exceptions.SSLError('self-signed certificate in certificate chain')
        with patch.object(portal.session, 'get', side_effect=original) as get:
            with self.assertRaises(requests.exceptions.SSLError) as caught:
                portal.fetch(BASE + '/zxd/portal/jhxdtz')
            self.assertIs(caught.exception.__cause__, original)
            self.assertIn('REQUESTS_CA_BUNDLE', str(caught.exception))
            self.assertIn('operating system', str(caught.exception))
            get.assert_called_once()
            self.assertNotIn('verify', get.call_args.kwargs)

    def test_live_diagnostic_continues_after_certificate_failure(self):
        with patch.object(check_catarc, 'Portal') as factory, \
                patch.object(check_catarc, 'parse_listing', return_value=([], 1)), \
                redirect_stdout(io.StringIO()) as output:
            portal = factory.return_value
            portal.fetch.side_effect = [requests.exceptions.SSLError('bad chain'), b'html', b'html']
            self.assertEqual(check_catarc.main(), 1)
            self.assertEqual(portal.fetch.call_count, 3)
            portal.close.assert_called_once()
            self.assertIn('releases', output.getvalue())
