"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCheck, ChevronRight, Clock3, Copy, HeartPulse, KeyRound, LoaderCircle, LogOut, Search, ShieldCheck, Stethoscope, X } from "lucide-react";

type Slot = { id: string; provider: string; start: string; end: string; available: boolean };
type Booking = { id: string; slot_id: string; name: string; email: string; status: "confirmed" | "cancelled"; created_at: string };
const zone = "Africa/Lagos";
const date = (value: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, ...options }).format(new Date(value));
const time = (value: string) => date(value, { hour: "2-digit", minute: "2-digit", hour12: true });
const dayKey = (value: string) => date(value, { year: "numeric", month: "2-digit", day: "2-digit" });
const initials = (provider: string) => provider.replace(/^Dr\.?\s+/i, "").split(" ").map(s => s[0]).slice(0, 2).join("");
class ApiError extends Error { constructor(message: string, public status: number, public retry: number) { super(message); } }

export default function Home() {
  const [key, setKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"book" | "manage">("book");
  const [day, setDay] = useState("");
  const [provider, setProvider] = useState("");
  const [selected, setSelected] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<Booking | null>(null);
  const [lookup, setLookup] = useState("");
  const [reference, setReference] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [copied, setCopied] = useState(false);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const retryRequest = useRef<{ body: string; key: string } | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  async function api<T>(path: string, init: RequestInit = {}, accessKey = key): Promise<T> {
    const response = await fetch(`/api${path}`, { ...init, headers: { "Content-Type": "application/json", "X-API-Key": accessKey, ...init.headers } });
    const body = await response.json() as T & { error?: string };
    if (!response.ok) {
      if (response.status === 401 && accessKey === key) { setKey(""); sessionStorage.removeItem("cedar-api-key"); setKeyOpen(true); }
      throw new ApiError(body.error || "The request could not be completed", response.status, Number(response.headers.get("Retry-After")) || 0);
    }
    return body;
  }
  function acceptSlots(items: Slot[]) {
    setSlots(items);
    setDay(current => items.some(s => dayKey(s.start) === current) ? current : dayKey(items.find(s => Date.parse(s.start) > Date.now())?.start || items[0]?.start || new Date().toISOString()));
  }
  async function refresh(accessKey = key) {
    setLoading(true);
    try { const data = await api<{ slots: Slot[] }>("/slots", {}, accessKey); acceptSlots(data.slots); }
    catch (e) { setMessage((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const saved = sessionStorage.getItem("cedar-api-key");
    if (saved) { setKey(saved); void refresh(saved); }
    // A saved key is used only for this browser tab; it is never embedded in source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (keyOpen) keyInput.current?.focus(); }, [keyOpen]);
  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = setTimeout(() => setRetrySeconds(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [retrySeconds]);
  async function connect(event: FormEvent) {
    event.preventDefault(); setConnecting(true); setConnectError("");
    try {
      const accessKey = keyDraft.trim();
      const data = await api<{ slots: Slot[] }>("/slots", {}, accessKey);
      setKey(accessKey); sessionStorage.setItem("cedar-api-key", accessKey); acceptSlots(data.slots);
      setKeyOpen(false); setKeyDraft(""); setMessage("");
    } catch (e) { setConnectError((e as Error).message); }
    finally { setConnecting(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!selected || busy || !key) return;
    setBusy(true); setMessage(""); setNotice("");
    const body = JSON.stringify({ slot_id: selected.id, name, email });
    if (retryRequest.current?.body !== body) retryRequest.current = { body, key: crypto.randomUUID() };
    try {
      const booking = await api<Booking>("/bookings", { method: "POST", body, headers: { "Idempotency-Key": retryRequest.current.key } });
      setConfirmation(booking); setLookup(booking.email); retryRequest.current = null;
      await refresh(); titleRef.current?.focus();
    } catch (e) {
      const err = e as ApiError; setMessage(err.message);
      if (err.status === 409) { setSelected(null); await refresh(); }
      if (err.status === 429) { setRetrySeconds(err.retry); retryRequest.current = null; }
      if (err.status && err.status !== 429) retryRequest.current = null;
    } finally { setBusy(false); }
  }
  async function findBookings(cursor?: string) {
    if (!key) { setKeyOpen(true); return; }
    setBusy(true); setMessage(""); setNotice("");
    try {
      const data = await api<{ bookings: Booking[]; next_cursor: string | null }>(`/bookings?email=${encodeURIComponent(lookup.trim())}&limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      setBookings(current => cursor ? [...current, ...data.bookings] : data.bookings); setNextCursor(data.next_cursor); setSearched(true);
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  async function findReference(event: FormEvent) {
    event.preventDefault(); if (!key) { setKeyOpen(true); return; }
    setBusy(true); setMessage(""); setNotice("");
    try { const booking = await api<Booking>(`/bookings/${encodeURIComponent(reference.trim())}`); setBookings([booking]); setNextCursor(null); setSearched(true); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!cancelTarget || busy) return;
    setBusy(true); setMessage("");
    try {
      const booking = await api<Booking>(`/bookings/${encodeURIComponent(cancelTarget.id)}`, { method: "DELETE" });
      setBookings(current => current.map(item => item.id === booking.id ? booking : item));
      if (confirmation?.id === booking.id) setConfirmation(booking);
      setCancelTarget(null); setNotice("Your appointment has been cancelled. The time is available again."); await refresh();
    } catch (e) { setMessage((e as Error).message); setCancelTarget(null); }
    finally { setBusy(false); }
  }
  function switchView(next: "book" | "manage") { setView(next); setMessage(""); setNotice(""); }
  const providers = [...new Set(slots.map(s => s.provider))];
  const filtered = slots.filter(s => !provider || s.provider === provider);
  const days = [...new Map(filtered.map(s => [dayKey(s.start), s.start])).entries()];
  const visible = filtered.filter(s => dayKey(s.start) === day);
  const available = visible.filter(s => s.available && Date.parse(s.start) > Date.now()).length;
  const selectedBookingSlot = confirmation ? slots.find(s => s.id === confirmation.slot_id) : selected;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Cedar Clinic home"><span className="brand-mark"><HeartPulse size={24} strokeWidth={1.8}/></span><span>cedar<span className="brand-sub">CLINIC</span></span></a>
      <div className="workspace-label">PATIENT PORTAL</div>
      <nav aria-label="Main navigation">
        <button className={`nav-item ${view === "book" ? "active" : ""}`} onClick={() => switchView("book")}><CalendarDays size={19}/> Book an appointment <ChevronRight size={15}/></button>
        <button className={`nav-item ${view === "manage" ? "active" : ""}`} onClick={() => switchView("manage")}><CheckCheck size={19}/> My appointments</button>
      </nav>
      <div className="sidebar-bottom"><div className="care-icon"><Stethoscope size={24}/></div><h3>A little care.<br/>A healthier you.</h3><p>Make time for what matters.<br/>We’ll take care of the rest.</p><div className="sidebar-rule"/><span><ShieldCheck size={14}/> Your details stay private</span></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Patient portal <ChevronRight size={14}/><strong>{view === "book" ? "Appointments" : "My appointments"}</strong></div><button className={`connection ${key ? "connected" : ""}`} onClick={() => { setConnectError(""); setKeyOpen(true); }}><span className="status-dot"/>{key ? "Connected" : "Connect API"}<KeyRound size={14}/></button></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow"><span/> A MOMENT FOR YOUR HEALTH</div><h1 ref={titleRef} tabIndex={-1}>{view === "book" ? "Good care starts here." : "Your care, all in one place."}</h1><p>{view === "book" ? "Find a time that fits your day. We’re here when you need us." : "Look up an appointment, review your details, or change your plans."}</p></div><div className="heading-note"><ShieldCheck size={18}/><span>Simple booking.<br/><strong>Thoughtful care.</strong></span></div></div>
        {message && <div className="alert error" role="alert">{message}<button aria-label="Dismiss error" onClick={() => setMessage("")}><X size={17}/></button></div>}
        {notice && <div className="alert success" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={17}/></button></div>}
        {view === "book" ? <div className="booking-layout">
          <section className="availability" aria-labelledby="availability-title">
            <div className="section-top"><div><span className="step-label">01 / CHOOSE YOUR TIME</span><h2 id="availability-title">Available appointments</h2></div><button className="text-button" disabled={!key || loading} onClick={() => refresh()}>{loading ? <LoaderCircle size={15} className="spin"/> : <Clock3 size={15}/>} Refresh</button></div>
            <div className="filter-row"><label className="provider-select"><Stethoscope size={17}/><select aria-label="Filter by clinician" value={provider} onChange={e => { const next = e.target.value; setProvider(next); const match = slots.find(s => (!next || s.provider === next) && dayKey(s.start) === day) || slots.find(s => !next || s.provider === next); if (match) setDay(dayKey(match.start)); }}><option value="">All clinicians</option>{providers.map(p => <option key={p}>{p}</option>)}</select></label><span className="timezone"><Clock3 size={13}/> West Africa Time (UTC+1)</span></div>
            {!key ? <div className="connect-empty"><div className="empty-icon"><CalendarDays size={30} strokeWidth={1.3}/></div><h3>Your next appointment awaits.</h3><p>Connect with your clinic access key to see<br className="desktop-break"/> available times and make a booking.</p><button className="primary-button" onClick={() => { setConnectError(""); setKeyOpen(true); }}><KeyRound size={16}/> Connect to clinic <ArrowRight size={16}/></button><span className="empty-foot">Have your demo API key ready</span></div> : <>
              {loading && !slots.length ? <div className="connect-empty" role="status"><LoaderCircle className="spin"/> Loading appointments…</div> : slots.length === 0 ? <div className="connect-empty"><CalendarDays size={30}/><h3>No appointments just yet</h3><p>The clinic hasn’t added any appointment slots.<br/>Please check back soon.</p></div> : <>
                <div className="date-strip" aria-label="Choose appointment date">{days.map(([keyDay, start]) => <button key={keyDay} className={`date-button ${day === keyDay ? "selected" : ""}`} onClick={() => setDay(keyDay)} aria-pressed={day === keyDay}><span>{date(start, { weekday: "short" })}</span><strong>{date(start, { day: "2-digit" })}</strong><span>{date(start, { month: "short" })}</span><i/></button>)}</div>
                <div className="day-summary"><strong>{visible[0] ? date(visible[0].start, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Choose a day"}</strong><span>{available} available</span></div>
                <div className="slots-grid">{visible.map(slot => { const past = Date.parse(slot.start) <= Date.now(); const disabled = !slot.available || past; return <button key={slot.id} disabled={disabled} aria-pressed={selected?.id === slot.id} className={`slot-card ${selected?.id === slot.id ? "chosen" : ""}`} onClick={() => { setSelected(slot); setConfirmation(null); setMessage(""); nameInput.current?.focus(); }}><div className="slot-card-top"><span className="avatar">{initials(slot.provider)}</span><span className="radio-indicator">{selected?.id === slot.id && <Check size={12}/>}</span></div><h3>{slot.provider}</h3><span className="slot-type">Clinic appointment</span><div className="slot-card-bottom"><strong>{time(slot.start)}</strong><span>{Math.round((Date.parse(slot.end) - Date.parse(slot.start)) / 60000)} min</span></div><div className={`slot-state ${disabled ? "unavailable" : ""}`}><i/>{past ? "Past appointment" : !slot.available ? "Booked" : "Available"}</div></button>; })}</div>
              </>}
            </>}
            <div className="availability-footer"><ShieldCheck size={16}/><span>Your chosen time is reserved once your booking is confirmed.</span></div>
          </section>
          <aside className={`details-panel ${confirmation ? "confirmed-panel" : ""}`} aria-labelledby="details-title">
            {confirmation ? <><div className={`confirmation-icon ${confirmation.status === "cancelled" ? "cancelled-icon" : ""}`}>{confirmation.status === "confirmed" ? <Check size={30}/> : <X size={30}/>}</div><span className="step-label">{confirmation.status === "confirmed" ? "YOU’RE ALL SET" : "PLANS CHANGED"}</span><h2 id="details-title">{confirmation.status === "confirmed" ? "See you soon." : "Appointment cancelled."}</h2><p className="panel-intro">{confirmation.status === "confirmed" ? `${confirmation.name}, your appointment is confirmed.` : "You can choose another time whenever you’re ready."}</p><div className="selected-summary"><span className="avatar">{initials(selectedBookingSlot?.provider || "Clinic")}</span><div><strong>{selectedBookingSlot?.provider || "Clinic appointment"}</strong><span>{selectedBookingSlot ? date(selectedBookingSlot.start, { day: "numeric", month: "long", year: "numeric" }) : confirmation.slot_id}</span>{selectedBookingSlot && <span>{time(selectedBookingSlot.start)} – {time(selectedBookingSlot.end)} WAT</span>}</div></div><dl className="confirmation-details"><dt>Patient</dt><dd>{confirmation.name}</dd><dt>Email</dt><dd>{confirmation.email}</dd><dt>Booking reference</dt><dd className="reference-value">{confirmation.id}<button aria-label="Copy booking reference" onClick={async () => { try { await navigator.clipboard.writeText(confirmation.id); setCopied(true); } catch { setMessage("Copy is unavailable in this browser. Select the reference to copy it."); } }}>{copied ? <Check size={14}/> : <Copy size={14}/>}</button></dd></dl><p className="small-note">Save your reference to look up this appointment later. No confirmation email is sent by this demo.</p>{confirmation.status === "confirmed" && <button className="secondary-button" onClick={() => setCancelTarget(confirmation)}>Cancel appointment</button>}<button className="primary-button" onClick={() => { setConfirmation(null); setSelected(null); setCopied(false); setNotice(""); }}><CalendarDays size={16}/> Book another appointment</button></> : <>
              <span className="step-label">02 / YOUR DETAILS</span><h2 id="details-title">Make it yours.</h2><p className="panel-intro">A few details, and you’re on your way.</p>
              {selected ? <div className="selected-summary"><span className="avatar">{initials(selected.provider)}</span><div><strong>{selected.provider}</strong><span>{date(selected.start, { weekday: "short", day: "numeric", month: "long" })}</span><span>{time(selected.start)} – {time(selected.end)} WAT</span></div><button aria-label="Clear selected appointment" onClick={() => setSelected(null)}><X size={16}/></button></div> : <div className="selection-placeholder"><CalendarDays size={22}/><span>Choose an appointment<br/><strong>Your time will appear here</strong></span></div>}
              <form onSubmit={submit} className="details-form"><label>Full name<input ref={nameInput} required maxLength={200} autoComplete="name" placeholder="e.g. Ada Obi" value={name} onChange={e => setName(e.target.value)}/></label><label>Email address<input required type="email" maxLength={254} autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)}/></label><p className="field-note">Use this email to find your appointments later.</p><button className="primary-button" type="submit" disabled={!selected || !key || busy || retrySeconds > 0}>{busy ? <><LoaderCircle size={17} className="spin"/> Booking…</> : retrySeconds > 0 ? `Try again in ${retrySeconds}s` : <>Confirm appointment <ArrowRight size={17}/></>}</button></form><div className="panel-assurance"><ShieldCheck size={16}/><p>Your details are used only to manage your appointment.</p></div>
            </>}
          </aside>
        </div> : <section className="manage-section">
          <div className="manage-forms"><form onSubmit={e => { e.preventDefault(); void findBookings(); }}><span className="step-label">FIND YOUR APPOINTMENTS</span><h2>Let’s look you up.</h2><label>Email address<div className="input-action"><input type="email" required value={lookup} onChange={e => { setLookup(e.target.value); setSearched(false); setBookings([]); setNextCursor(null); }} placeholder="you@example.com"/><button className="primary-button" disabled={busy}><Search size={17}/><span>Find appointments</span></button></div></label></form><form onSubmit={findReference} className="reference-form"><span className="step-label">HAVE A BOOKING REFERENCE?</span><label>Booking reference<div className="input-action"><input required value={reference} onChange={e => setReference(e.target.value)} placeholder="Paste your booking reference"/><button className="secondary-button" disabled={busy}>Look up <ArrowRight size={16}/></button></div></label></form></div>
          {busy && <div className="loading-line" role="status"><LoaderCircle size={17} className="spin"/> Updating your appointments…</div>}
          {bookings.length > 0 ? <div className="booking-list">{bookings.map(booking => { const slot = slots.find(s => s.id === booking.slot_id); return <article className="booking-row" key={booking.id}><div className="booking-row-date"><CalendarDays size={23}/></div><div className="booking-row-main"><h3>{slot?.provider || "Clinic appointment"}<span className={`booking-badge ${booking.status}`}>{booking.status}</span></h3><p>{slot ? `${date(slot.start, { weekday: "short", day: "numeric", month: "long", year: "numeric" })} · ${time(slot.start)} WAT` : `Slot ${booking.slot_id}`}</p><span>{booking.name} · {booking.email}</span><code>{booking.id}</code></div>{booking.status === "confirmed" && <button className="cancel-link" onClick={() => setCancelTarget(booking)} disabled={busy}>Cancel appointment</button>}</article>; })}{nextCursor && <button className="secondary-button load-more" disabled={busy} onClick={() => findBookings(nextCursor)}>Load more appointments <ArrowRight size={16}/></button>}</div> : <div className="manage-empty"><CalendarDays size={34} strokeWidth={1.3}/><h3>{searched ? "No appointments found" : "Your appointments, at a glance."}</h3><p>{searched ? "Check your email address or make your first booking." : "Enter your email or booking reference to get started."}</p></div>}
        </section>}
        <footer className="page-footer"><span>© {new Date().getFullYear()} Cedar Clinic</span><span>Care that fits your life.</span><a href="https://koyaacademy.com/assessment-api" target="_blank" rel="noreferrer">API specification <ArrowRight size={12}/></a></footer>
      </main>
    </div>
    {keyOpen && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !connecting) setKeyOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="key-title" onKeyDown={e => { if (e.key === "Escape" && !connecting) setKeyOpen(false); }}><button className="modal-close" aria-label="Close access key dialog" disabled={connecting} onClick={() => setKeyOpen(false)}><X size={20}/></button><div className="empty-icon"><KeyRound size={26}/></div><span className="step-label">CLINIC ACCESS</span><h2 id="key-title">Welcome to Cedar.</h2><p>Enter the API key supplied with this demo to view and book appointments.</p>{connectError && <div className="alert error" role="alert">{connectError}</div>}<form onSubmit={connect}><label>API key<input ref={keyInput} type="password" autoComplete="off" required value={keyDraft} onChange={e => setKeyDraft(e.target.value)} placeholder="Enter your clinic API key"/></label><button className="primary-button" disabled={connecting}>{connecting ? <><LoaderCircle size={16} className="spin"/> Connecting…</> : <>Connect securely <ArrowRight size={16}/></>}</button></form><p className="small-note"><ShieldCheck size={14}/> Your key stays in this tab’s session and is sent only to this clinic.</p>{key && <button className="text-button disconnect" onClick={() => { sessionStorage.removeItem("cedar-api-key"); setKey(""); setSlots([]); setSelected(null); setConfirmation(null); setBookings([]); setKeyOpen(false); }}><LogOut size={15}/> Disconnect this tab</button>}</section></div>}
    {cancelTarget && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title"><span className="step-label">CHANGE OF PLANS</span><h2 id="cancel-title">Cancel this appointment?</h2><p>This releases your reserved time. You can book it again if it’s still available.</p><div className="modal-actions"><button className="secondary-button" disabled={busy} onClick={() => setCancelTarget(null)}><ArrowLeft size={15}/> Keep appointment</button><button className="danger-button" disabled={busy} onClick={cancel}>{busy ? "Cancelling…" : "Yes, cancel"}</button></div></section></div>}
  </div>;
}
