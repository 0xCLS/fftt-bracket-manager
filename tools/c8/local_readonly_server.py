#!/usr/bin/env python3
"""C8 local-only fixed-port read-only rehearsal. Run from repository root. Never logs URLs."""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from functools import partial
import webbrowser
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass
 def end_headers(self):
  self.send_header("Cache-Control","no-store")
  self.send_header("Referrer-Policy","no-referrer")
  super().end_headers()
def main():
 with ThreadingHTTPServer(("127.0.0.1",3000),Quiet) as srv:
  print("C8 isolated synthetic read-only login · http://localhost:3000/rehearsals/c8/index.html")
  print("Uses fixed 127.0.0.1 port 3000; stop if another server occupies the port.")
  print("No login email until you click Request Magic Link in the browser.")
  webbrowser.open("http://localhost:3000/rehearsals/c8/index.html")
  try:srv.serve_forever()
  except KeyboardInterrupt:pass
if __name__=="__main__":main()
