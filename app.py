from flask import Flask, render_template, request, jsonify
from sms import SendSms
import threading
import requests
import os
import re

app = Flask(__name__)

is_running = False

@app.route('/')
def index():
    return render_template('index.html')

def sonsuz_gonder(tel, mail):
    global is_running
    sms_araci = SendSms(tel, mail)
    servisler = [f for f in dir(SendSms) if callable(getattr(SendSms, f)) and not f.startswith("__")]
    while is_running:
        threads = []
        for servis in servisler:
            if not is_running: break
            t = threading.Thread(target=getattr(sms_araci, servis))
            threads.append(t)
            t.start()
        for t in threads:
            t.join()

@app.route('/islem', methods=['POST'])
def islem():
    global is_running
    data = request.json
    action = data.get('action')
    if action == 'baslat':
        if not is_running:
            is_running = True
            tel = data.get('tel')
            mail = data.get('mail', "")
            threading.Thread(target=sonsuz_gonder, args=(tel, mail), daemon=True).start()
            return jsonify({"status": "çalışıyor"})
    else:
        is_running = False
        return jsonify({"status": "durdu"})
    return jsonify({"status": "error"})

# ══════════════════════════════════════════
#  DISCORD ID LOOKUP
#  Render Dashboard → Environment Variables:
#  Key: DISCORD_TOKEN  |  Value: bot tokenin
# ══════════════════════════════════════════

@app.route('/api/discord/user/<user_id>')
def discord_lookup(user_id):
    if not re.fullmatch(r'\d{17,20}', user_id):
        return jsonify({'error': 'Geçersiz Discord ID'}), 400

    token = os.environ.get('DISCORD_TOKEN')
    if not token:
        return jsonify({'error': 'Discord token yapılandırılmamış'}), 500

    try:
        r = requests.get(
            f'https://discord.com/api/v10/users/{user_id}',
            headers={'Authorization': f'Bot {token}'},
            timeout=10
        )
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
