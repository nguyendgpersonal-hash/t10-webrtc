const $ = (id) => document.getElementById(id);

const roomInput = $("room");
const joinBtn = $("joinBtn");
const leaveBtn = $("leaveBtn");
const statusEl = $("status");
const peerIdEl = $("peerId");
const dcStatusEl = $("dcStatus");
const candidateTypesEl = $("candidateTypes");
const fileInput = $("fileInput");
const sendBtn = $("sendBtn");
const progressEl = $("progress");
const transferStatusEl = $("transferStatus");
const logEl = $("log");
const statsBtn = $("statsBtn");
const statsEl = $("stats");

const CHUNK_SIZE = 16 * 1024;
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" }
];

const params = new URLSearchParams(location.search);
const FORCE_RELAY = params.has("relay");

// A stable-ish random peer id for this browser tab.
const peerId = crypto.randomUUID().slice(0, 8);
peerIdEl.textContent = peerId;

let ws = null;
let pc = null;
let dc = null;
let currentRoom = null;
let remotePeerPresent = false;
let pendingCandidates = [];

let incoming = null;

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
  console.log(line);
}

function setStatus(message) {
  statusEl.textContent = message;
}

function setDataChannelStatus(message) {
  dcStatusEl.textContent = message;
  const ready = dc && dc.readyState === "open";
  fileInput.disabled = !ready;
  sendBtn.disabled = !ready;
  statsBtn.disabled = !ready;
}

function sendSignal(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function createPeerConnection() {
  if (pc) pc.close();

  pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    iceTransportPolicy: FORCE_RELAY ? "relay" : "all"
  });

  log(`RTCPeerConnection created; iceTransportPolicy=${FORCE_RELAY ? "relay" : "all"}`);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({ type: "candidate", candidate: event.candidate });
    }
  };

  pc.onicecandidateerror = (event) => {
    log(`ICE error: ${event.errorCode} ${event.errorText || ""}`);
  };

  pc.oniceconnectionstatechange = () => {
    log(`ICE state: ${pc.iceConnectionState}`);
    setStatus(`ICE: ${pc.iceConnectionState}`);
  };

  pc.onconnectionstatechange = () => {
    log(`Connection state: ${pc.connectionState}`);
    if (pc.connectionState === "connected") setStatus("Connected");
    if (pc.connectionState === "failed") setStatus("Connection failed");
  };

  pc.ondatachannel = (event) => {
    log("Received remote DataChannel");
    setupDataChannel(event.channel);
  };

  pc.onicegatheringstatechange = () => {
    log(`ICE gathering: ${pc.iceGatheringState}`);
  };

  return pc;
}

function setupDataChannel(channel) {
  dc = channel;
  dc.binaryType = "arraybuffer";
  dc.bufferedAmountLowThreshold = 256 * 1024;

  dc.onopen = () => {
    log("DataChannel OPEN");
    setDataChannelStatus("Open");
  };

  dc.onclose = () => {
    log("DataChannel CLOSED");
    setDataChannelStatus("Closed");
  };

  dc.onerror = (event) => {
    log("DataChannel ERROR");
    console.error(event);
  };

  dc.onmessage = handleDataMessage;
}

async function makeOffer() {
  createPeerConnection();
  setupDataChannel(pc.createDataChannel("file"));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  sendSignal({
    type: "offer",
    description: pc.localDescription
  });
  log("Sent offer");
}

async function handleOffer(description) {
  createPeerConnection();

  await pc.setRemoteDescription(description);

  for (const candidate of pendingCandidates) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      log(`Could not add queued candidate: ${err.message}`);
    }
  }
  pendingCandidates = [];

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  sendSignal({
    type: "answer",
    description: pc.localDescription
  });
  log("Sent answer");
}

async function handleAnswer(description) {
  if (!pc) return;
  await pc.setRemoteDescription(description);

  for (const candidate of pendingCandidates) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      log(`Could not add queued candidate: ${err.message}`);
    }
  }
  pendingCandidates = [];
  log("Remote answer applied");
}

async function handleCandidate(candidate) {
  if (!pc || !pc.remoteDescription) {
    pendingCandidates.push(candidate);
    return;
  }
  try {
    await pc.addIceCandidate(candidate);
  } catch (err) {
    log(`ICE candidate error: ${err.message}`);
  }
}

function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws/${encodeURIComponent(currentRoom)}/${encodeURIComponent(peerId)}`);

  ws.onopen = () => {
    setStatus("Signaling connected");
    log(`WebSocket connected to room "${currentRoom}"`);
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    try {
      switch (msg.type) {
        case "peer-joined":
          remotePeerPresent = true;
          log(`Peer joined: ${msg.from}`);
          // The peer already inside the room creates the offer.
          await makeOffer();
          break;

        case "offer":
          remotePeerPresent = true;
          log("Received offer");
          await handleOffer(msg.description);
          break;

        case "answer":
          log("Received answer");
          await handleAnswer(msg.description);
          break;

        case "candidate":
          await handleCandidate(msg.candidate);
          break;

        case "room-full":
          log("Room is full (maximum 2 peers)");
          setStatus("Room full");
          ws.close();
          break;

        case "peer-left":
          log(`Peer left: ${msg.from}`);
          remotePeerPresent = false;
          if (dc) dc.close();
          if (pc) pc.close();
          pc = null;
          dc = null;
          setDataChannelStatus("Closed");
          setStatus("Waiting for peer");
          break;

        default:
          log(`Unknown signaling message: ${msg.type}`);
      }
    } catch (err) {
      log(`Signaling handling error: ${err.message}`);
      console.error(err);
    }
  };

  ws.onclose = () => {
    setStatus("Signaling disconnected");
    log("WebSocket closed");
  };

  ws.onerror = () => log("WebSocket error");
}

function sendJSON(obj) {
  dc.send(JSON.stringify(obj));
}

async function sha256(blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sendFile(file) {
  if (!dc || dc.readyState !== "open") {
    log("DataChannel is not open");
    return;
  }

  sendBtn.disabled = true;
  fileInput.disabled = true;
  progressEl.value = 0;
  transferStatusEl.textContent = "Calculating SHA-256...";

  const hash = await sha256(file);

  sendJSON({
    type: "file-meta",
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
    hash
  });

  log(`Sending ${file.name} (${file.size} bytes), SHA-256=${hash}`);

  let offset = 0;

  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();

    while (dc.bufferedAmount > 4 * 1024 * 1024) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    dc.send(buffer);
    offset += buffer.byteLength;

    const percent = file.size ? (offset / file.size) * 100 : 100;
    progressEl.value = percent;
    transferStatusEl.textContent = `Sending: ${percent.toFixed(1)}%`;
  }

  sendJSON({ type: "file-end" });
  transferStatusEl.textContent = "File sent";
  log("Finished sending file");

  sendBtn.disabled = false;
  fileInput.disabled = false;
}

function handleDataMessage(event) {
  if (typeof event.data === "string") {
    const msg = JSON.parse(event.data);

    if (msg.type === "file-meta") {
      incoming = {
        name: msg.name,
        size: msg.size,
        mime: msg.mime,
        hash: msg.hash,
        chunks: [],
        received: 0
      };
      progressEl.value = 0;
      transferStatusEl.textContent = `Receiving ${msg.name}...`;
      log(`Receiving ${msg.name} (${msg.size} bytes), expected SHA-256=${msg.hash}`);
    } else if (msg.type === "file-end") {
      finishIncomingFile();
    }
    return;
  }

  if (!incoming) {
    log("Received binary data without file metadata");
    return;
  }

  const chunk = new Uint8Array(event.data);
  incoming.chunks.push(chunk);
  incoming.received += chunk.byteLength;

  progressEl.value = incoming.size ? (incoming.received / incoming.size) * 100 : 100;
  transferStatusEl.textContent =
    `Receiving: ${progressEl.value.toFixed(1)}%`;
}

async function finishIncomingFile() {
  if (!incoming) return;

  const blob = new Blob(incoming.chunks, { type: incoming.mime });
  const actualHash = await sha256(blob);
  const ok = actualHash === incoming.hash;

  log(`Receive complete: ${incoming.name}`);
  log(`SHA-256 expected=${incoming.hash}`);
  log(`SHA-256 actual=${actualHash}`);
  log(`hashOk=${ok}`);

  transferStatusEl.textContent = ok
    ? `Received successfully — SHA-256 OK`
    : `Received — SHA-256 MISMATCH`;

  if (ok) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = incoming.name;
    a.textContent = `Download ${incoming.name}`;
    a.style.display = "block";
    a.className = "ok";
    transferStatusEl.appendChild(a);
  }

  incoming = null;
}

async function refreshStats() {
  if (!pc) return;

  const report = await pc.getStats();
  const lines = [];
  const candidateTypes = new Set();

  report.forEach((s) => {
    if (s.type === "candidate-pair" && s.state === "succeeded") {
      lines.push(`candidate-pair: ${s.localCandidateId} <-> ${s.remoteCandidateId}`);
      lines.push(`state=${s.state}`);
    }
    if (s.type === "local-candidate") {
      candidateTypes.add(s.candidateType);
    }
    if (s.type === "remote-candidate") {
      candidateTypes.add(`remote:${s.candidateType}`);
    }
  });

  candidateTypesEl.textContent = [...candidateTypes].join(", ") || "-";
  statsEl.textContent = lines.join("\n") || "No succeeded candidate pair yet.";
}

joinBtn.onclick = () => {
  currentRoom = roomInput.value.trim() || "demo";
  logEl.textContent = "";
  log(`Joining room "${currentRoom}"`);
  joinBtn.disabled = true;
  leaveBtn.disabled = false;
  connectWebSocket();
};

leaveBtn.onclick = () => {
  if (dc) dc.close();
  if (pc) pc.close();
  if (ws) ws.close();

  dc = null;
  pc = null;
  ws = null;
  remotePeerPresent = false;
  setDataChannelStatus("Closed");
  setStatus("Disconnected");
  joinBtn.disabled = false;
  leaveBtn.disabled = true;
  log("Left room");
};

sendBtn.onclick = async () => {
  const file = fileInput.files[0];
  if (file) {
    try {
      await sendFile(file);
    } catch (err) {
      log(`File send error: ${err.message}`);
      sendBtn.disabled = false;
      fileInput.disabled = false;
    }
  }
};

statsBtn.onclick = refreshStats;

if (FORCE_RELAY) {
  log("FORCE_RELAY enabled: only relay candidates are allowed.");
}
