import { useRef, useState } from "react";
import { DEFAULT_ACCENT } from "./ProfilesRail.jsx";

const MAP_HEIGHT = 86;
const MAP_PADDING = 6;
const MIN_MARKER = 10;

function layout(displays, width) {
  const minX = Math.min(...displays.map((d) => d.bounds.x));
  const minY = Math.min(...displays.map((d) => d.bounds.y));
  const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
  const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
  const scale = Math.min((width - MAP_PADDING * 2) / (maxX - minX), (MAP_HEIGHT - MAP_PADDING * 2) / (maxY - minY));
  const toMap = (x, y) => ({ left: MAP_PADDING + (x - minX) * scale, top: MAP_PADDING + (y - minY) * scale });
  const toScreen = (left, top) => ({ x: (left - MAP_PADDING) / scale + minX, y: (top - MAP_PADDING) / scale + minY });
  return { scale, toMap, toScreen };
}

// Every connected display drawn to scale, with each session window as a
// marker in its profile colour. Click focuses it; drag moves the real window.
export default function MonitorMap({ displays, sessions }) {
  const hostRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const width = 360;
  if (displays.length === 0) return null;
  const { scale, toMap, toScreen } = layout(displays, width);
  const { bridge } = window.hekaton;

  function onPointerDown(event, session) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = toMap(session.bounds.x, session.bounds.y);
    setDrag({
      id: session.id,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      left: origin.left,
      top: origin.top,
      moved: false,
    });
  }

  function onPointerMove(event) {
    if (!drag || drag.id !== event.currentTarget.dataset.id) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    setDrag({
      ...drag,
      left: drag.origin.left + dx,
      top: drag.origin.top + dy,
      moved: drag.moved || Math.hypot(dx, dy) > 3,
    });
  }

  function onPointerUp(event) {
    if (!drag || drag.id !== event.currentTarget.dataset.id) return;
    if (drag.moved) {
      const { x, y } = toScreen(drag.left, drag.top);
      bridge.moveTo(drag.id, x, y);
    } else {
      bridge.focus(drag.id);
    }
    setDrag(null);
  }

  return (
    <div className="monitor-map" ref={hostRef} style={{ width, height: MAP_HEIGHT }} aria-label="Monitor map">
      {displays.map((display) => {
        const pos = toMap(display.bounds.x, display.bounds.y);
        return (
          <div
            key={display.id}
            className="monitor-map__display"
            title={display.label}
            style={{ ...pos, width: display.bounds.width * scale, height: display.bounds.height * scale }}
          />
        );
      })}
      {sessions
        .filter((session) => session.bounds)
        .map((session) => {
          const dragging = drag?.id === session.id;
          const pos = dragging ? { left: drag.left, top: drag.top } : toMap(session.bounds.x, session.bounds.y);
          return (
            <div
              key={session.id}
              data-id={session.id}
              className={`monitor-map__session${dragging ? " is-dragging" : ""}`}
              title={session.profile.name}
              style={{
                ...pos,
                width: Math.max(MIN_MARKER, session.bounds.width * scale),
                height: Math.max(MIN_MARKER * 0.7, session.bounds.height * scale),
                background: session.profile.accent ?? DEFAULT_ACCENT,
              }}
              onPointerDown={(event) => onPointerDown(event, session)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          );
        })}
    </div>
  );
}
