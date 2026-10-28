import type { ScheduleBlock } from "../models/ScheduleBlock";
import playlistService from "./PlaylistService";
import audioEngine from "./AudioEngine";
import eventLogService from "./EventLogService";
import clockService from "./ClockService";

const REFILL_TARGET = 20;
const REFILL_MAX_ADD = 8;
const MAX_QUEUE = 500;
type StoredSchedule = { version: 2; blocks: ScheduleBlock[]; autoPilot: boolean };

class ScheduleService {
  private blocks: ScheduleBlock[] = [];
  private autoPilot = true;
  private loaded = false;
  private listeners = new Set<() => void>();
  private lastTickMinute = -1;

  constructor() { void this.init(); window.setInterval(() => this.tick(), 5000); }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private notify() { this.listeners.forEach((listener) => listener()); }

  private async init() {
    try {
      const saved: unknown = await window.rsp.scheduleLoad();
      if (Array.isArray(saved)) this.blocks = saved;
      else if (saved && typeof saved === "object") {
        const data = saved as Partial<StoredSchedule>;
        if (Array.isArray(data.blocks)) this.blocks = data.blocks;
        if (typeof data.autoPilot === "boolean") this.autoPilot = data.autoPilot;
      }
    } catch { /* se usan valores seguros */ }
    if (this.blocks.length === 0) this.blocks = [{ id: 1, day: -1, startMin: 0, endMin: 1440, fill: true }];
    this.loaded = true;
    this.persist();
    this.notify();
    this.tick();
  }

  private persist() {
    if (!this.loaded) return;
    const data: StoredSchedule = { version: 2, blocks: this.blocks, autoPilot: this.autoPilot };
    void window.rsp.scheduleSave(data);
  }

  getBlocks() { return this.blocks.map((block) => ({ ...block })); }
  isAutoPilot() { return this.autoPilot; }

  setAutoPilot(on: boolean) {
    this.autoPilot = on;
    eventLogService.push("auto", `Piloto automático: ${on ? "AUTO" : "MANUAL"}`);
    this.persist(); this.notify();
    if (on) this.tick();
  }

  addBlock() {
    const id = Math.max(0, ...this.blocks.map((block) => block.id)) + 1;
    this.blocks.push({ id, day: -1, startMin: 0, endMin: 1440, fill: true });
    eventLogService.push("auto", "Bloque de programación añadido.");
    this.persist(); this.notify();
  }

  updateBlock(id: number, patch: Partial<ScheduleBlock>) {
    const block = this.blocks.find((item) => item.id === id);
    if (!block) return;
    const startMin = patch.startMin ?? block.startMin;
    const endMin = patch.endMin ?? block.endMin;
    if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || startMin > 1439 || endMin < 1 || endMin > 1440) return;
    Object.assign(block, patch);
    this.persist(); this.notify();
  }

  removeBlock(id: number) {
    this.blocks = this.blocks.filter((block) => block.id !== id);
    eventLogService.push("auto", "Bloque de programación eliminado.");
    this.persist(); this.notify();
  }

  getActiveBlock(now = new Date()): ScheduleBlock | null {
    const minutes = now.getHours() * 60 + now.getMinutes();
    const today = now.getDay();
    const yesterday = (today + 6) % 7;
    return this.blocks.find((block) => {
      const matchesDay = (day: number) => block.day === -1 || block.day === day;
      if (block.startMin < block.endMin) {
        return matchesDay(today) && minutes >= block.startMin && minutes < block.endMin;
      }
      if (block.startMin > block.endMin) {
        // Tras medianoche el bloque pertenece al día en que comenzó.
        return minutes >= block.startMin ? matchesDay(today) : matchesDay(yesterday);
      }
      // Igual inicio y fin representa un bloque de 24 horas del día elegido.
      return matchesDay(today);
    }) ?? null;
  }

  private tick() {
    const now = new Date();
    if (now.getMinutes() !== this.lastTickMinute) { this.lastTickMinute = now.getMinutes(); this.notify(); }
    if (this.autoPilot) this.refill();
  }

  private refill() {
    // Si un reloj de parrilla rige la hora, él alimenta la cola (no duplicar).
    if (clockService.hasClockFor(new Date())) return;
    const active = this.getActiveBlock();
    if (!active?.fill) return;
    const queue = playlistService.getTracks();
    const library = playlistService.getLibrary().filter((track) => Boolean(track.file));
    if (library.length === 0) return;

    const toAdd = Math.min(REFILL_MAX_ADD, REFILL_TARGET - queue.length, MAX_QUEUE - queue.length);
    for (let i = 0; i < Math.max(0, toAdd); i += 1) {
      const recentArtists = new Set(queue.slice(-3).map((track) => track.artist.toLocaleLowerCase()));
      const candidates = library.filter((track) => !recentArtists.has(track.artist.toLocaleLowerCase()));
      const pool = candidates.length > 0 ? candidates : library;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      playlistService.enqueueFromLibrary(pick.id, false);
      queue.push({ ...pick });
    }
    if (toAdd > 0) {
      eventLogService.push("auto", `Relleno: +${toAdd} pistas desde biblioteca.`);
      // Una única notificación y persistencia luego de rellenar evita renders/escrituras en cascada.
      playlistService.flush();
    }
    if (audioEngine.getState() === "stopped" && playlistService.getTracks().length > 0) void audioEngine.play();
  }
}

export default new ScheduleService();