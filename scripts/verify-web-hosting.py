"""Check the real website over TLS; --address tests an origin before DNS settles."""
import argparse
import http.client
import json
import socket
import ssl


parser = argparse.ArgumentParser()
parser.add_argument('--address', help='Connect to this IP while still validating the domain certificate')
args = parser.parse_args()


class OriginConnection(http.client.HTTPSConnection):
    def connect(self):
        connection = socket.create_connection((args.address or self.host, self.port), self.timeout)
        self.sock = self._context.wrap_socket(connection, server_hostname=self.host)


def request(host, path, method='GET', headers=None, body=None, port=443):
    connection = OriginConnection(host, port=port, timeout=20, context=ssl.create_default_context())
    connection.request(method, path, body=body, headers=headers or {})
    response = connection.getresponse()
    content = response.read()
    result = response.status, dict(response.getheaders()), content
    connection.close()
    return result


for host in ('tinyfrens.lol', 'www.tinyfrens.lol'):
    for path, expected_type in [('/', 'text/html'), ('/web/', 'text/html'),
                                ('/web/gallery.html', 'text/html'),
                                ('/web/robot-live.mjs', 'application/javascript'),
                                ('/web/manifest.webmanifest', 'application/manifest+json'),
                                ('/web/sw.js', 'application/javascript'),
                                ('/docs/', 'text/html'), ('/server/WEB_HOSTING.html', 'text/html'),
                                ('/.well-known/farcaster.json', 'application/json'),
                                ('/snap-v2.json', 'application/vnd.farcaster.snap+json'),
                                ('/import/skill.md', 'text/plain')]:
        status, headers, content = request(host, path)
        assert status == 200, (host, path, status)
        assert expected_type in headers.get('Content-Type', ''), (host, path, headers)
        assert content, (host, path, 'empty response')
    for path in ('/', '/snap', '/api/snap'):
        status, headers, content = request(host, path, headers={'Accept':'application/vnd.farcaster.snap+json'})
        assert status == 200, (host, path, status)
        assert 'application/vnd.farcaster.snap+json' in headers.get('Content-Type', ''), headers
        assert isinstance(json.loads(content), dict)
        assert headers.get('Access-Control-Allow-Origin') == '*', headers
    status, headers, content = request(host, '/api/snap/interact?action=pet', method='POST',
                                      headers={'Content-Type':'application/json'}, body='{}')
    assert status == 200, (host, 'Snap POST', status, content[:200])
    for path in ('/admin', '/api/admin/state', '/.env', '/web/admin.html'):
        assert request(host, path)[0] == 404, (host, path, 'must not be public')
    for path, destination in [('/skill.md', '/import/skill.md'), ('/web/robot-preview.html', '/web/gallery.html')]:
        status, headers, _ = request(host, path)
        assert status in (301, 308) and headers['Location'].endswith(destination), (host, path, status, headers)
    connection = http.client.HTTPConnection(args.address or host, timeout=20)
    connection.request('GET', '/', headers={'Host':host})
    response = connection.getresponse()
    assert response.status in (301, 308) and response.getheader('Location') == f'https://{host}/'
    connection.close()
    print(f'{host}: HTTPS, site/app/gallery, manifests, skills, Snap GET/POST, redirects and private-path checks passed')
