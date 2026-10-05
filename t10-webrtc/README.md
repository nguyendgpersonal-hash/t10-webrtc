# T10 – WebRTC P2P File Transfer

Project goal: demonstrate peer-to-peer file transfer using WebRTC DataChannel.

## Architecture

```text
Browser A <-> FastAPI WebSocket signaling <-> Browser B
                         |
                         | SDP / ICE only
                         v
                 WebRTC DataChannel
                         |
                    P2P file data
                         |
                    TURN fallback
```

The signaling server relays JSON signaling messages only. It does not receive or store the file.

## Project structure

```text
t10-webrtc/
├── server/
│   ├── main.py
│   └── requirements.txt
├── client/
│   ├── index.html
│   └── app.js
├── experiments/
│   ├── analyze.py
│   └── logs/
├── evidence/
├── .gitignore
└── README.md
```

## 1. Run locally

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r server/requirements.txt
cd server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Open:

```text
http://localhost:8000
```

Open the page in two browser tabs/windows. In both tabs use the same room, for example `demo`, then click **Join room**.

The first peer creates the WebRTC offer when the second peer joins.

## 2. Test file transfer

1. Join the same room from two tabs.
2. Wait for `DataChannel OPEN`.
3. Select a file in one tab.
4. Click **Send file**.
5. The receiver calculates SHA-256 and reports `SHA-256 OK`.
6. Use **Refresh WebRTC stats** to inspect candidate information.

For the coursework, use a 100 MB test file and record the SHA-256 result.

## 3. Force TURN relay

After TURN/coturn is configured, append:

```text
?relay
```

Example:

```text
https://YOUR-DOMAIN/?relay
```

The client then uses:

```text
iceTransportPolicy = relay
```

This is useful for the E3 experiment.

## 4. Experiments

Recommended scenarios:

- E1: same Wi-Fi -> normally host candidate may be selected.
- E2: Wi-Fi + 4G/mobile network -> srflx or relay may be selected.
- E3: Wi-Fi + 4G with `?relay` -> relay must be selected.

Record at least:

- scenario
- candidate type
- file size
- SHA-256
- hashOk
- transfer result

Store experiment logs under `experiments/logs/`.

Analyze them with:

```powershell
python experiments/analyze.py
```

## 5. Wireshark evidence

Capture traffic while running the WebRTC test.

Useful display filters:

```text
stun
```

and:

```text
dtls
```

After the DTLS handshake, WebRTC application data should not appear as readable file contents.

Save `.pcapng` files locally rather than committing large captures to Git.

## 6. TURN/coturn

The browser configuration in `client/app.js` currently contains Google's public STUN server as a local-development fallback.

For the real deployment, replace `ICE_SERVERS` with the team's coturn server configuration, for example:

```javascript
const ICE_SERVERS = [
  { urls: "stun:YOUR_PUBLIC_IP:3478" },
  {
    urls: [
      "turn:YOUR_PUBLIC_IP:3478?transport=udp",
      "turn:YOUR_PUBLIC_IP:3478?transport=tcp"
    ],
    username: "YOUR_USERNAME",
    credential: "YOUR_PASSWORD"
  }
];
```

Do not commit real TURN credentials to a public GitHub repository.

## 7. GitHub

Create a GitHub repository named:

```text
t10-webrtc
```

Then from the project root:

```powershell
git init
git branch -M main
git add .
git commit -m "Initial T10 WebRTC project"
git remote add origin https://github.com/YOUR_USERNAME/t10-webrtc.git
git push -u origin main
```

If the repository already exists remotely and contains a README, either create an empty repository first or pull/reconcile the remote before pushing.

## 8. Role A completion checklist

- [ ] A1 local FastAPI/WebRTC demo works
- [ ] A2 VPS created and reachable by SSH
- [ ] A3 signaling: offer/answer/candidate/peer-left/room-full
- [ ] A4 coturn installed and relay candidate tested
- [ ] A5 HTTPS/WSS deployed
- [ ] E1/E2/E3 tested
- [ ] A6 Wireshark evidence captured
- [ ] A7 backup demo video recorded
