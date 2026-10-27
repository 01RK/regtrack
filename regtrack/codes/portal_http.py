"""Verified HTTPS for CATARC, using OS-managed roots without global SSL patches."""
import ssl

import requests
from requests.adapters import HTTPAdapter
import truststore


class SystemTrustAdapter(HTTPAdapter):
    """Keep Requests proxy/CA-bundle support, replace only its TLS context."""

    def __init__(self):
        self.ssl_context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        super().__init__()

    def build_connection_pool_key_attributes(self, request, verify, cert=None):
        if verify is False:
            raise ValueError("CATARC HTTPS certificate verification cannot be disabled")
        host, options = super().build_connection_pool_key_attributes(request, verify, cert)
        options["ssl_context"] = self.ssl_context
        return host, options


def create_session():
    session = requests.Session()
    session.mount("https://", SystemTrustAdapter())
    # Leave trust_env=True: Requests handles HTTPS_PROXY / NO_PROXY and optional
    # REQUESTS_CA_BUNDLE / CURL_CA_BUNDLE, in addition to native system trust.
    return session


def certificate_error(url):
    return (
        f"HTTPS certificate verification failed: {url}. "
        "RegTrack uses the operating system certificate store. "
        "If your browser works, ask IT to check the enterprise HTTPS proxy root/intermediate "
        "certificates in the operating system trust store used by the RegTrack service. "
        "An IT-provided PEM CA bundle can also be set with REQUESTS_CA_BUNDLE. "
        "Check an existing REQUESTS_CA_BUNDLE/CURL_CA_BUNDLE for an obsolete path or certificate. "
        "Certificate verification remains enabled; no insecure retry was made."
    )
