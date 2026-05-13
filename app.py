from flask import Flask, render_template, request, jsonify
from sms import SendSms
import threading

app = Flask(__name__)

# Gönderim durumunu takip etmek için
is_running = False

@app.route('/')
def index():
    return render_template('index.html')

def sonsuz_gonder(tel, mail):
    global is_running
    sms_araci = SendSms(tel, mail)
    
    # SendSms içindeki servisleri bul
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
    action = data.get('action') # 'baslat' veya 'durdur'
    
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)