import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import "./SchedulerModal.css";
import scheduleService from "../../services/ScheduleService";
import clockService from "../../services/ClockService";
import generatorService, { type GeneratedItem } from "../../services/GeneratorService";
import playlistService from "../../services/PlaylistService";
import audioEngine from "../../services/AudioEngine";
import type { ScheduleBlock } from "../../models/ScheduleBlock";

export type SchedulerTab = "week" | "grid";

/* ── Constantes ─────────────────────────────────────────────── */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DAY_LONG = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const HOUR_PX = 26;
const SNAP = 15;

/* ── Helpers ────────────────────────────────────────────────── */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Minutos → HH:MM (1440 se muestra como 24:00). */
function fmtMin(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/** <input type="time"> no admite 24:00: se muestra 23:59 (el bloque conserva 1440). */
function toTimeInput(minutes: number): string {
  return minutes === 1440 ? "23:59" : fmtMin(minutes);
}

function fromTimeInput(value: string): number {
  const [hh, mm] = value.split(":").map(Number);
  return (hh || 0) * 60 + (mm || 0);
}

function dayLabel(day: number): string {
  return day === -1 ? "Todos los días" : DAY_LONG[day] ?? "?";
}

function fmtHMS(totalSeconds: number): string {
  const safe = ((Math.round(totalSeconds) % 86400) + 86400) % 86400;
  return `${pad2(Math.floor(safe / 3600))}:${pad2(Math.floor((safe % 3600) / 60))}:${pad2(safe % 60)}`;
}

function fmtDur(seconds: number): string {
  const total = Math.round(seconds);
  if (!total || total <= 0) return "—";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

function fmtStamp(at: number): string {
  const date = new Date(at);
  return `${date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })} ${date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

const KIND_LABEL: Record<GeneratedItem["kind"], string> = {
  category: "Categoría",
  cart: "Cart",
  track: "Música",
};

interface Segment {
  block: ScheduleBlock;
  day: number;
  from: number;
  to: number;
}

/** Un bloque puede aparecer en varios días y cruzar medianoche (misma semántica que getActiveBlock). */
function segmentsOf(block: ScheduleBlock): Segment[] {
  const days = block.day === -1 ? [0, 1, 2, 3, 4, 5, 6] : [block.day];
  const out: Segment[] = [];
  for (const day of days) {
    if (block.startMin < block.endMin) {
      out.push({ block, day, from: block.startMin, to: block.endMin });
    } else if (block.startMin > block.endMin) {
      out.push({ block, day, from: block.startMin, to: 1440 });
      out.push({ block, day: (day + 1) % 7, from: 0, to: block.endMin });
    } else {
      out.push({ block, day, from: 0, to: 1440 });
    }
  }
  return out;
}

function minuteAt(element: HTMLElement | null, clientY: number): number {
  if (!element) return 0;
  const y = clientY - element.getBoundingClientRect().top;
  const snapped = Math.round(((y / HOUR_PX) * 60) / SNAP) * SNAP;
  return Math.min(1440, Math.max(0, snapped));
}

function createBlock(day: number, from: number, to: number): number | null {
  scheduleService.addBlock();
  const list = scheduleService.getBlocks();
  const created = list[list.length - 1];
  if (!created) return null;
  scheduleService.updateBlock(created.id, { day, startMin: Math.min(1439, from), endMin: Math.max(1, to) });
  return created.id;
}

/* ── Reloj de cabecera (su propio intervalo: no re-renderiza la grilla) ── */
function HeaderClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="pgClock">
      <b>{now.toLocaleTimeString("es-AR", { hour12: false })}</b>
      <span>{now.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}</span>
    </div>
  );
}

/* ── Pestaña Semana ─────────────────────────────────────────── */
function WeekTab({ now }: { now: Date }) {
  const blocks = scheduleService.getBlocks();
  const active = scheduleService.getActiveBlock(now);
  const clocks = clockService.getClocks();
  const grid = clockService.getGrid();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ day: number; a: number; b: number } | null>(null);
  const [brush, setBrush] = useState<number | "none" | "erase">("none");
  const dragRef = useRef<{ day: number; a: number; b: number } | null>(null);
  const dragEl = useRef<HTMLElement | null>(null);
  const brushRef = useRef<number | "none" | "erase">("none");
  brushRef.current = brush;
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragging = drag !== null;

  const selected = blocks.find((block) => block.id === selectedId) ?? null;
  const today = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const segments = blocks.flatMap(segmentsOf);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (new Date().getHours() - 1) * HOUR_PX);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const next = { ...current, b: minuteAt(dragEl.current, event.clientY) };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = () => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!current) return;
      const lo = Math.min(current.a, current.b);
      const hi = Math.max(current.a, current.b);
      const brushNow = brushRef.current;
      // Con pincel: pinta horas con el reloj (clic = 1 hora, arrastre = rango).
      if (brushNow !== "none") {
        const fromHour = Math.floor(lo / 60);
        const toHour = hi - lo >= SNAP ? Math.floor((hi - 1) / 60) : fromHour;
        for (let hour = fromHour; hour <= Math.min(23, toHour); hour += 1) {
          clockService.setCell(current.day, hour, brushNow === "erase" ? null : brushNow);
        }
        return;
      }
      if (hi - lo >= SNAP) {
        const id = createBlock(current.day, lo, hi);
        if (id !== null) setSelectedId(id);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  useEffect(() => {
    if (selectedId === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Delete") return;
      const tag = (event.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      scheduleService.removeBlock(selectedId);
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  function startDrag(event: ReactMouseEvent<HTMLDivElement>, day: number) {
    if (event.button !== 0) return;
    dragEl.current = event.currentTarget;
    const minute = minuteAt(event.currentTarget, event.clientY);
    dragRef.current = { day, a: minute, b: minute };
    setDrag(dragRef.current);
    setSelectedId(null);
    event.preventDefault();
  }

  function addFromButton() {
    scheduleService.addBlock();
    const list = scheduleService.getBlocks();
    setSelectedId(list[list.length - 1]?.id ?? null);
  }

  const bodyStyle = { height: HOUR_PX * 24, "--hour-px": `${HOUR_PX}px` } as CSSProperties;

  return (
    <div className="pgBody">
      <aside className="pgSide">
        <div className="pgSideHead">
          <h3>Bloques de programación</h3>
          <button className="pgBtn primary" onClick={addFromButton}>+ Añadir</button>
        </div>
        <label className="pgBrushRow" title="Pinta celdas de hora con un reloj (clic = 1 hora, arrastre = rango)">
          <span>Pincel</span>
          <select
            value={String(brush)}
            onChange={(event) => {
              const value = event.target.value;
              setBrush(value === "none" || value === "erase" ? value : Number(value));
            }}
          >
            <option value="none">Bloques</option>
            {clocks.map((clock) => (
              <option key={clock.id} value={clock.id}>🖌 {clock.name}</option>
            ))}
            <option value="erase">🧽 Borrar reloj</option>
          </select>
        </label>

        <div className="pgTableWrap">
          <table className="pgTable">
            <thead>
              <tr><th>Día</th><th>Inicio</th><th>Fin</th><th>Relleno</th></tr>
            </thead>
            <tbody>
              {blocks.map((block) => (
                <tr
                  key={block.id}
                  className={`${block.id === selectedId ? "isSel" : ""}${active?.id === block.id ? " isLive" : ""}`}
                  onClick={() => setSelectedId(block.id)}
                >
                  <td>{block.day === -1 ? "Todos" : DAY_SHORT[block.day]}</td>
                  <td className="num">{fmtMin(block.startMin)}</td>
                  <td className="num">{fmtMin(block.endMin)}</td>
                  <td>{block.fill ? "Sí" : "No"}</td>
                </tr>
              ))}
              {blocks.length === 0 && (
                <tr className="pgEmptyRow"><td colSpan={4}>Sin bloques. Arrastra sobre la grilla o pulsa Añadir.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selected ? (
          <div className="pgEditor">
            <h3>Propiedades del bloque</h3>
            <label className="pgField">
              <span>Día</span>
              <select
                value={String(selected.day)}
                onChange={(event) => scheduleService.updateBlock(selected.id, { day: Number(event.target.value) })}
              >
                <option value="-1">Todos los días</option>
                {DAY_ORDER.map((day) => (
                  <option key={day} value={day}>{DAY_LONG[day]}</option>
                ))}
              </select>
            </label>
            <div className="pgFieldRow">
              <label className="pgField">
                <span>Inicio</span>
                <input
                  type="time"
                  value={toTimeInput(selected.startMin)}
                  onChange={(event) => scheduleService.updateBlock(selected.id, { startMin: fromTimeInput(event.target.value) })}
                />
              </label>
              <label className="pgField">
                <span>Fin</span>
                <div className="pgInline">
                  <input
                    type="time"
                    value={toTimeInput(selected.endMin)}
                    onChange={(event) => scheduleService.updateBlock(selected.id, { endMin: fromTimeInput(event.target.value) })}
                  />
                  <button
                    className="pgBtn"
                    title="Hasta el final del día"
                    onClick={() => scheduleService.updateBlock(selected.id, { endMin: 1440 })}
                  >
                    24:00
                  </button>
                </div>
              </label>
            </div>
            <label className="pgCheck" title="Añade pistas de la biblioteca cuando la cola se acaba">
              <input
                type="checkbox"
                checked={selected.fill}
                onChange={(event) => scheduleService.updateBlock(selected.id, { fill: event.target.checked })}
              />
              Relleno automático (nunca silencio)
            </label>
            <button
              className="pgBtn danger"
              onClick={() => {
                scheduleService.removeBlock(selected.id);
                setSelectedId(null);
              }}
            >
              Eliminar bloque
            </button>
          </div>
        ) : (
          <p className="pgHint">
            Pincel en Bloques: arrastra para crear, clic para editar, Supr para borrar.
            Con pincel de reloj: clic pinta 1 hora, arrastre pinta el rango, goma borra.
            Un bloque con fin menor que inicio cruza la medianoche.
          </p>
        )}
      </aside>

      <div className="wkMain">
        <div className="wkScroll" ref={scrollRef}>
          <div className="wkHead">
            <div className="wkCorner" />
            {DAY_ORDER.map((day) => (
              <div key={day} className={`wkDayHead${day === today ? " isToday" : ""}`}>{DAY_SHORT[day]}</div>
            ))}
          </div>
          <div className="wkBody" style={bodyStyle}>
            <div className="wkGutter">
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={hour} className="wkHour"><span>{pad2(hour)}:00</span></div>
              ))}
            </div>
            {DAY_ORDER.map((day) => (
              <div
                key={day}
                className={`wkCol${day === today ? " isToday" : ""}`}
                onMouseDown={(event) => startDrag(event, day)}
              >
                {segments.filter((segment) => segment.day === day).map((segment, index) => {
                  const { block } = segment;
                  const classes = [
                    "wkBlock",
                    block.fill ? "fill" : "nofill",
                    block.id === selectedId ? "isSel" : "",
                    active?.id === block.id ? "isLive" : "",
                    segment.to - segment.from < 60 ? "short" : "",
                  ].join(" ");
                  return (
                    <div
                      key={`${block.id}-${index}`}
                      className={classes}
                      style={{ top: (segment.from / 60) * HOUR_PX, height: ((segment.to - segment.from) / 60) * HOUR_PX }}
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        setSelectedId(block.id);
                      }}
                      title={`${dayLabel(block.day)} ${fmtMin(block.startMin)}–${fmtMin(block.endMin)}${block.fill ? " · relleno" : " · sin relleno"}`}
                    >
                      <b>{fmtMin(segment.from)}–{fmtMin(segment.to)}</b>
                      <span>{block.fill ? "Relleno" : "Sin relleno"}</span>
                    </div>
                  );
                })}
                {Array.from({ length: 24 }, (_, hour) => {
                  const clockId = grid[String(day)]?.[String(hour)];
                  if (typeof clockId !== "number") return null;
                  const clock = clocks.find((item) => item.id === clockId);
                  if (!clock) return null;
                  return (
                    <div
                      key={`paint-${hour}`}
                      className="wkPaint"
                      style={{ top: hour * HOUR_PX, height: HOUR_PX, background: `${clock.color}2e`, borderColor: clock.color }}
                      title={`${clock.name} · ${pad2(hour)}:00 (goma o pincel para cambiar)`}
                    >
                      <span style={{ color: clock.color }}>{clock.name.slice(0, 12)}</span>
                    </div>
                  );
                })}
                {drag && drag.day === day && (
                  <div
                    className="wkDrag"
                    style={{
                      top: (Math.min(drag.a, drag.b) / 60) * HOUR_PX,
                      height: (Math.abs(drag.b - drag.a) / 60) * HOUR_PX,
                    }}
                  >
                    <b>{fmtMin(Math.min(drag.a, drag.b))}–{fmtMin(Math.max(drag.a, drag.b))}</b>
                  </div>
                )}
                {day === today && <div className="wkNow" style={{ top: (nowMin / 60) * HOUR_PX }} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Pestaña Parrilla ───────────────────────────────────────── */
function GridTab({ now }: { now: Date }) {
  const clocks = clockService.getClocks();
  const results = generatorService.getResults();
  // Estado inicial blindado: datos legacy jamás revientan el primer render.
  const [clockId, setClockId] = useState<number>(() => {
    try {
      return clockService.getActiveId() ?? clockService.getClocks()[0]?.id ?? 0;
    } catch {
      return 0;
    }
  });
  const [hours, setHours] = useState<number[]>(() => [new Date().getHours()]);
  const [open, setOpen] = useState<Set<number>>(() => new Set([new Date().getHours()]));

  const currentHour = now.getHours();
  const nowSecs = currentHour * 3600 + now.getMinutes() * 60 + now.getSeconds();

  function toggleHour(hour: number) {
    setHours((prev) => (prev.includes(hour) ? prev.filter((h) => h !== hour) : [...prev, hour].sort((a, b) => a - b)));
  }

  function toggleOpen(hour: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(hour)) next.delete(hour);
      else next.add(hour);
      return next;
    });
  }

  function generate() {
    if (clockId <= 0 || hours.length === 0) return;
    generatorService.generate(clockId, hours);
    setOpen(new Set(hours));
  }

  function loadHour(hour: number, play: boolean) {
    if (!generatorService.loadHourToPlaylist(hour)) return;
    if (!play) return;
    const target = playlistService.getPlaylists().find((list) => list.name === `${pad2(hour)}:00`);
    if (target) {
      playlistService.setActive(target.id);
      void audioEngine.play();
    }
  }

  const sorted = [...results].sort((a, b) => a.hour - b.hour);

  return (
    <div className="pgBody">
      <aside className="pgSide">
        <div className="pgSideHead"><h3>Generar parrilla</h3></div>

        <label className="pgField">
          <span>Plantilla de reloj</span>
          <select value={clockId} onChange={(event) => setClockId(Number(event.target.value))}>
            <option value={0}>— elegir —</option>
            {clocks.map((clock) => (
              <option key={clock.id} value={clock.id}>{clock.name} ({clock.slots.length} slots)</option>
            ))}
          </select>
        </label>

        <div className="pgField">
          <div className="pgLabelRow">
            <span>Horas a generar ({hours.length})</span>
            <span className="pgLinks">
              <button onClick={() => setHours(Array.from({ length: 24 }, (_, h) => h))}>Todas</button>
              <button onClick={() => setHours([currentHour])}>Actual</button>
              <button onClick={() => setHours([])}>Ninguna</button>
            </span>
          </div>
          <div className="pgChips">
            {Array.from({ length: 24 }, (_, hour) => (
              <button
                key={hour}
                className={`pgChip${hours.includes(hour) ? " on" : ""}${hour === currentHour ? " cur" : ""}`}
                aria-pressed={hours.includes(hour)}
                onClick={() => toggleHour(hour)}
              >
                {pad2(hour)}
              </button>
            ))}
          </div>
        </div>

        <button className="pgBtn primary big" onClick={generate} disabled={clockId <= 0 || hours.length === 0}>
          Generar parrilla
        </button>
        <p className="pgHint">
          Resuelve cada slot con el algoritmo (filtros y antigüedad) usando duraciones reales.
          Los carts suenan en vivo y no se cargan a la playlist.
        </p>
      </aside>

      <div className="gridMain">
        <div className="gridToolbar">
          <h3>Resultados</h3>
          <span className="pgDim">{sorted.length} {sorted.length === 1 ? "hora generada" : "horas generadas"}</span>
          {sorted.length > 0 && (
            <button className="pgBtn" onClick={() => generatorService.clearResults()}>Limpiar resultados</button>
          )}
        </div>

        {sorted.length === 0 ? (
          <p className="pgEmpty">Aún no hay parrilla. Elige una plantilla y las horas, y pulsa Generar parrilla.</p>
        ) : (
          sorted.map((row) => {
            const isOpen = open.has(row.hour);
            const isCurrent = row.hour === currentHour;
            const total = row.items.reduce((sum, item) => sum + item.duration, 0);
            let playingIndex = -1;
            if (isCurrent) {
              row.items.forEach((item, index) => {
                if (row.hour * 3600 + item.at <= nowSecs) playingIndex = index;
              });
            }
            return (
              <section className={`gridHour${isCurrent ? " isCur" : ""}`} key={`${row.hour}-${row.createdAt}`}>
                <header className="gridHourHead" onClick={() => toggleOpen(row.hour)}>
                  <span className="gridCaret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                  <b className="num">{pad2(row.hour)}:00</b>
                  <span className="gridHourName">{row.clockName}</span>
                  <span className="pgDim">
                    {row.items.length} ítems · {fmtDur(total)} · generado {fmtStamp(row.createdAt)}
                  </span>
                  {row.warnings.length > 0 && <span className="pgBadge warn">{row.warnings.length} avisos</span>}
                  <span className="gridHourActions" onClick={(event) => event.stopPropagation()}>
                    <button className="pgBtn" onClick={() => loadHour(row.hour, false)}>Cargar a playlist</button>
                    <button className="pgBtn primary" onClick={() => loadHour(row.hour, true)}>Poner al aire</button>
                  </span>
                </header>
                {isOpen && (
                  <table className="pgTable">
                    <thead>
                      <tr><th>Hora</th><th>Tipo</th><th>Título</th><th className="r">Duración</th><th>Estado</th></tr>
                    </thead>
                    <tbody>
                      {row.items.map((item, index) => (
                        <tr key={index} className={index === playingIndex ? "isNow" : ""}>
                          <td className="num">{fmtHMS(row.hour * 3600 + item.at)}</td>
                          <td><span className={`pgKind ${item.kind}`}>{KIND_LABEL[item.kind]}</span></td>
                          <td className="title">{item.title}</td>
                          <td className="num r">{fmtDur(item.duration)}</td>
                          <td className={item.warnings.length > 0 ? "warn" : "ok"}>
                            {item.warnings.length > 0 ? `⚠ ${item.warnings.join("; ")}` : "Listo"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ── Modal ──────────────────────────────────────────────────── */
const SCHEDULER_TAB_KEY = "rsp.scheduler.tab";

export default function SchedulerModal({ onClose, initialTab }: { onClose: () => void; initialTab?: SchedulerTab }) {
  const [, setRevision] = useState(0);
  // Explícita manda (botones Semana/Parrilla); si nadie la pide, vale la recordada.
  const [tab, setTab] = useState<SchedulerTab>(() => {
    if (initialTab === "week" || initialTab === "grid") return initialTab;
    try {
      const stored = localStorage.getItem(SCHEDULER_TAB_KEY);
      if (stored === "week" || stored === "grid") return stored;
    } catch {
      // Sin recuerdo: semana.
    }
    return "week";
  });
  const [now, setNow] = useState(() => new Date());
  const onCloseRef = useRef(onClose);

  function changeTab(next: SchedulerTab) {
    setTab(next);
    try {
      localStorage.setItem(SCHEDULER_TAB_KEY, next);
    } catch {
      // Best-effort.
    }
  }

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const bump = () => setRevision((value) => value + 1);
    const subs = [scheduleService.subscribe(bump), clockService.subscribe(bump), generatorService.subscribe(bump)];
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      subs.forEach((unsub) => unsub());
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const auto = scheduleService.isAutoPilot();
  const active = scheduleService.getActiveBlock(now);
  const feeding = clockService.getClockFor(now);
  const feeder = feeding
    ? `Reloj «${feeding.name}»`
    : active?.fill
      ? "Relleno desde la biblioteca"
      : "Ninguno";

  return (
    <div
      className="pgOverlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="pgModal" role="dialog" aria-label="Programador">
        <header className="pgHead">
          <h2>Programador</h2>
          <nav className="pgTabs" role="tablist">
            <button role="tab" aria-selected={tab === "week"} className={tab === "week" ? "on" : ""} onClick={() => changeTab("week")}>
              Semana
            </button>
            <button role="tab" aria-selected={tab === "grid"} className={tab === "grid" ? "on" : ""} onClick={() => changeTab("grid")}>
              Parrilla
            </button>
          </nav>
          <div className="pgSpacer" />
          <HeaderClock />
          <button
            className={`pgPilot ${auto ? "on" : "off"}`}
            onClick={() => scheduleService.setAutoPilot(!auto)}
            title={auto ? "Piloto automático activo" : "Piloto automático apagado"}
          >
            <i aria-hidden="true" />
            {auto ? "AUTO" : "MANUAL"}
          </button>
          <button className="pgClose" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>

        <div className="pgStatus">
          <div>
            <small>Bloque activo</small>
            <b>
              {active
                ? `${dayLabel(active.day)} ${fmtMin(active.startMin)}–${fmtMin(active.endMin)}${active.fill ? " · relleno" : " · sin relleno"}`
                : auto ? "Ninguno (en espera)" : "Control manual"}
            </b>
          </div>
          <div>
            <small>Alimenta la cola</small>
            <b>{auto ? feeder : "Manual"}</b>
          </div>
        </div>

        {tab === "week" ? <WeekTab now={now} /> : <GridTab now={now} />}

        <footer className="pgFoot">
          <span className="pgDim">Esc para cerrar</span>
          <button className="pgBtn" onClick={onClose}>Cerrar</button>
        </footer>
      </section>
    </div>
  );
}
