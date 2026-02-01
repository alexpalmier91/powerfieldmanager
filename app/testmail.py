
import os, smtplib, ssl, socket
from email.message import EmailMessage

HOST = os.getenv("SMTP_HOST","smtp.gmail.com")
USER = os.getenv("SMTP_USER","")
PASS = os.getenv("SMTP_PASS","")
PORT = int(os.getenv("SMTP_PORT","587"))
FROM = os.getenv("SMTP_USER","")
TO   = USER

# Force IPv4
orig = socket.getaddrinfo
def v4(host, port, family=0, type=0, proto=0, flags=0):
    return orig(host, port, socket.AF_INET, type, proto, flags)
socket.getaddrinfo = v4

msg = EmailMessage()
msg["Subject"] = "TEST SMTP zentro (force IPv4)"
msg["From"] = FROM
msg["To"] = TO
msg.set_content("Test SMTP depuis zentro-api (force IPv4).")

print("HOST", HOST, "PORT", PORT, "USER", USER, "FROM", FROM, "TO", TO)

if PORT == 465:
    with smtplib.SMTP_SSL(HOST, PORT, context=ssl.create_default_context(), timeout=20) as s:
        s.set_debuglevel(1)
        s.login(USER, PASS)
        s.send_message(msg)
else:
    with smtplib.SMTP(HOST, PORT, timeout=20) as s:
        s.set_debuglevel(1)
        s.ehlo()
        s.starttls(context=ssl.create_default_context())
        s.ehlo()
        s.login(USER, PASS)
        s.send_message(msg)

print("✅ envoyé")

