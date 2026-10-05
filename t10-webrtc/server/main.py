"""Signaling server cho T10: chỉ relay message JSON giữa 2 peer trong cùng room."""
import json
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

app = FastAPI()
rooms: dict[str, dict[str, WebSocket]] = {}  # room -> {peer_id: websocket}


@app.websocket("/ws/{room}/{peer_id}")
async def signaling(ws: WebSocket, room: str, peer_id: str):
    await ws.accept()
    peers = rooms.setdefault(room, {})
    if len(peers) >= 2:
        await ws.send_json({"type": "room-full"})
        await ws.close()
        return

    peers[peer_id] = ws
    print(f"[{room}] {peer_id} joined ({len(peers)}/2)")

    # Báo cho người đang ở trong room biết có người mới -> người đó sẽ tạo offer
    for pid, other in peers.items():
        if pid != peer_id:
            await other.send_json({"type": "peer-joined", "from": peer_id})

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            print(f"[{room}] {peer_id} -> {msg.get('type')} ({len(raw)} bytes)")
            for pid, other in peers.items():
                if pid != peer_id:
                    await other.send_text(raw)
    except WebSocketDisconnect:
        pass
    finally:
        peers.pop(peer_id, None)
        print(f"[{room}] {peer_id} left")
        for other in peers.values():
            await other.send_json({"type": "peer-left", "from": peer_id})
        if not peers:
            rooms.pop(room, None)


# Phục vụ luôn thư mục client/ tại "/" (đặt SAU route websocket)
app.mount("/", StaticFiles(directory=Path(__file__).parent.parent / "client", html=True), name="client")
