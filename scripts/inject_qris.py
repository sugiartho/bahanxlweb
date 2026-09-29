with open('/tmp/qris_b64.txt') as f: b64 = f.read().strip()
with open('/mnt/volume_sgp1_1781186006004/projects/me-cli-sunset/webui/templates/donasi.html', 'r') as f: content = f.read()
with open('/mnt/volume_sgp1_1781186006004/projects/me-cli-sunset/webui/templates/donasi.html', 'w') as f: f.write(content.replace('QQQ', b64))
