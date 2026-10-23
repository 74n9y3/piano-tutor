"""Open the practice app in a desktop window. The page and the server are the same one used in the browser."""

from __future__ import annotations

import threading
import time
import urllib.request

import uvicorn
import webview

from backend.main import app


def _wait_until_ready(url: str) -> None:
    for _ in range(80):
        try:
            with urllib.request.urlopen(url, timeout=0.3) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("本地服务没有启动")


def main() -> None:
    port = 8765
    server = threading.Thread(
        target=lambda: uvicorn.run(app, host="127.0.0.1", port=port, log_level="info"),
        daemon=True,
    )
    server.start()
    url = f"http://127.0.0.1:{port}/"
    _wait_until_ready(url + "api/health")
    webview.create_window("钢琴陪练", url, width=1280, height=840, min_size=(960, 680))
    webview.start()


if __name__ == "__main__":
    main()
