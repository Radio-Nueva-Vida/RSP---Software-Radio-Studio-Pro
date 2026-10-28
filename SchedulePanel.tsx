import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
  Component,
  type ReactNode,
} from "react";
import "./SchedulePanel.css";
import scheduleService from "../../services/ScheduleService";
import clockService from "../../services/ClockService";
import type { SchedulerTab } from "../SchedulerModal/SchedulerModal";

const SchedulerModal = lazy(() => import("../SchedulerModal/SchedulerModal"));

const WEEKDAYS = [
  "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado",
] as const;

function fmtMin(minutes: number): string {
  const hh = Math.floor(minutes / 60).toString().padStart(2, "0");
  const mm = (minutes % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function dayLabel(day: number): string {
  return day === -1 ? "Todos los días" : WEEKDAYS[day] ?? "Día desconocido";
}

/* ───────────────── Error Boundary para el chunk lazy ───────────────── */

interface BoundaryProps {
  onClose: () => void;
  children: ReactNode;
}
interface BoundaryState {
  hasError: boolean;
}

class ModalErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[SchedulePanel] Error cargando el modal:", error);
  }

  render() {
    if (this.state.hasError) {
      return <ModalFallback onClose={this.props.onClose} isError />;
    }
    return this.props.children;
  }
}

/* ───────────────── Fallback visible (loading / error) ───────────────── */

function ModalFallback({
  onClose,
  isError = false,
}: {
  onClose: () => void;
  isError?: boolean;
}) {
  return (
    <div
      className="pgOverlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="pgModal"
        role="dialog"
        aria-modal="true"
        aria-label="Programador"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="pgHead">
          <h2>Programador</h2>
          <div className="pgSpacer" />
          <button className="pgClose" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <p className={`pgEmpty ${isError ? "pgEmptyError" : ""}`}>
          {isError ? (
            <>⚠️ No se pudo cargar el programador. Verifica tu conexión e inténtalo de nuevo.</>
          ) : (
            <>
              <span className="pgSpinner" aria-hidden="true" />
              Cargando programador… Si esto no cierra, pulsa Esc o Cerrar.
            </>
          )}
        </p>
        <footer className="pgFoot">
          <span className="pgDim">Esc para cerrar</span>
          <button className="pgBtn" onClick={onClose}>
            Cerrar
          </button>
        </footer>
      </section>
    </div>
  );
}

/* ───────────────── Subcomponentes de presentación ───────────────── */

function PilotToggle({ auto, onToggle }: { auto: boolean; onToggle: () => void }) {
  return (
    <button
      className={`pilotBtn ${auto ? "pilotOn" : "pilotOff"}`}
      onClick={onToggle}
      aria-pressed={auto}
      title={
        auto
          ? "Piloto automático activo — clic para pasar a manual"
          : "Piloto automático apagado — clic para activar"
      }
    >
      <span className="pilotDot" aria-hidden="true" />
      {auto ? "AUTO" : "MANUAL"}
    </button>
  );
}

function StatusRow({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="statusRow">
      <dt>
        <span className="statusIcon" aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

/* ───────────────── Componente principal ───────────────── */

export default function SchedulePanel() {
  const [revision, setRevision] = useState(0);
  const [modal, setModal] = useState<SchedulerTab | null>(null);

  useEffect(() => {
    const bump = () => setRevision((value) => value + 1);
    const subs = [scheduleService.subscribe(bump), clockService.subscribe(bump)];
    return () => subs.forEach((unsub) => unsub());
  }, []);

  // Esc cierra el modal aunque el chunk lazy no haya montado.
  useEffect(() => {
    if (!modal) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);

  const closeModal = useCallback(() => setModal(null), []);
  const openWeek = useCallback(() => setModal("week"), []);
  const openGrid = useCallback(() => setModal("grid"), []);
  const toggleAuto = useCallback(() => {
    scheduleService.setAutoPilot(!scheduleService.isAutoPilot());
  }, []);

  const { auto, blockText, feederText } = useMemo(() => {
    const isAuto = scheduleService.isAutoPilot();
    const active = scheduleService.getActiveBlock();
    const clock = clockService.getClockFor();

    const block = active
      ? `${dayLabel(active.day)} ${fmtMin(active.startMin)}–${fmtMin(active.endMin)}`
      : isAuto
        ? "Sin bloque activo"
        : "Control manual";

    const feeder = !isAuto
      ? "Cola manual"
      : clock
        ? `Reloj «${clock.name}»`
        : active?.fill
          ? "Relleno de biblioteca"
          : "Sin alimentación";

    return { auto: isAuto, blockText: block, feederText: feeder };
    // revision dispara el recálculo al recibir eventos de los servicios
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  return (
    <section className="schedulePanel" aria-label="Panel de programación">
      <div className="scheduleHeader">
        <span className="scheduleTitle">Programador</span>
        <PilotToggle auto={auto} onToggle={toggleAuto} />
      </div>

      <dl className="scheduleStatus" aria-live="polite">
        <StatusRow label="Bloque" value={blockText} icon="🎬" />
        <StatusRow label="Cola" value={feederText} icon="🎵" />
      </dl>

      <div className="scheduleBtnRow">
        {/* Se conserva blocksToggle: Herramientas ▸ Programador (App.tsx) la usa */}
        <button className="blocksToggle" onClick={openWeek} title="Bloques semanales de programación">
          <span aria-hidden="true">🗓️</span> Semana y bloques
        </button>
        <button className="parrillaOpen" onClick={openGrid} title="Generador de parrilla por reloj">
          <span aria-hidden="true">📋</span> Parrilla
        </button>
      </div>

      {modal && (
        <ModalErrorBoundary onClose={closeModal}>
          <Suspense fallback={<ModalFallback onClose={closeModal} />}>
            <SchedulerModal initialTab={modal} onClose={closeModal} />
          </Suspense>
        </ModalErrorBoundary>
      )}
    </section>
  );
}
