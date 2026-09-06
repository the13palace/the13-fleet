const cfg = window.FLEET_CONFIG || {};
const configured =
  cfg.SUPABASE_URL &&
  cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_URL.includes("PASTE_") &&
  !cfg.SUPABASE_ANON_KEY.includes("PASTE_");

const client = configured
  ? supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

const $ = (id) => document.getElementById(id);

function setView(name){
  $("loginView").classList.toggle("active", name === "login");
  $("mainView").classList.toggle("active", name === "main");
}

function showMessage(el, text, type=""){
  el.textContent = text || "";
  el.className = "message" + (type ? ` ${type}` : "");
}

function esc(v){
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[c]);
}

function fmtTime(iso){
  if(!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
}

function bookingNo(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  const ss = String(d.getSeconds()).padStart(2,"0");
  return `WEB-${y}${m}${day}-${hh}${mm}${ss}`;
}

async function currentProfile(){
  const { data: { user } } = await client.auth.getUser();
  if(!user) return null;

  const { data, error } = await client
    .from("app_users")
    .select("employee_no, display_name, role, driver_id, active")
    .eq("auth_user_id", user.id)
    .eq("active", true)
    .single();

  if(error) throw error;
  return data;
}

async function boot(){
  if(!configured){
    setView("login");
    showMessage(
      $("loginMessage"),
      "Open config.js and add your Supabase Project URL and publishable/anon key first.",
      "error"
    );
    return;
  }

  const { data: { session } } = await client.auth.getSession();

  if(!session){
    setView("login");
    return;
  }

  try{
    const profile = await currentProfile();
    if(!profile) throw new Error("No active app user profile.");
    $("userBadge").textContent = profile.role;
    setView("main");
    await refreshAll();
  }catch(err){
    await client.auth.signOut();
    setView("login");
    showMessage($("loginMessage"), err.message, "error");
  }
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  if(!client){
    showMessage($("loginMessage"), "config.js is not configured.", "error");
    return;
  }

  showMessage($("loginMessage"), "Signing in...");

  const { error } = await client.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value
  });

  if(error){
    showMessage($("loginMessage"), error.message, "error");
    return;
  }

  try{
    const profile = await currentProfile();
    $("userBadge").textContent = profile.role;
    setView("main");
    showMessage($("loginMessage"), "");
    await refreshAll();
  }catch(err){
    await client.auth.signOut();
    showMessage($("loginMessage"), err.message, "error");
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await client.auth.signOut();
  setView("login");
});

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".page").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    $(`page-${btn.dataset.page}`).classList.add("active");
  });
});

$("refreshBtn").addEventListener("click", refreshAll);

async function loadBookings(){
  const start = new Date();
  start.setHours(0,0,0,0);
  const end = new Date(start);
  end.setDate(end.getDate()+1);

  const { data, error } = await client
    .from("bookings")
    .select(`
      id, booking_no, guest_name, room_no, guest_count, luggage_count,
      vip_level, pickup_time, pickup_location, destination,
      required_vehicle_type, status, dispatch_reason,
      vehicles:assigned_vehicle_id(vehicle_no),
      drivers:assigned_driver_id(employee_no,name)
    `)
    .gte("pickup_time", start.toISOString())
    .lt("pickup_time", end.toISOString())
    .order("pickup_time", {ascending:true});

  if(error) throw error;
  return data || [];
}

async function loadFleet(){
  const { data, error } = await client
    .from("vehicles")
    .select("id, vehicle_no, vehicle_type, seat_capacity, status, updated_at")
    .order("vehicle_type")
    .order("vehicle_no");

  if(error) throw error;
  return data || [];
}

function renderTrips(trips){
  const html = trips.length ? trips.map(t => `
    <article class="trip-card ${["VIP","VVIP","CHAIRMAN"].includes(t.vip_level) ? "vip":""}">
      <div class="trip-top">
        <div>
          <div class="trip-time">${esc(fmtTime(t.pickup_time))} · ${esc(t.vip_level || "STANDARD")}</div>
          <div class="trip-meta">${esc(t.booking_no)} · ${esc(t.guest_name || "Guest")}${t.room_no ? " · Room " + esc(t.room_no):""}</div>
        </div>
        <span class="status">${esc(t.status)}</span>
      </div>
      <div class="trip-route">${esc(t.pickup_location)} → ${esc(t.destination)}</div>
      <div class="trip-meta">
        ${esc(t.required_vehicle_type || "AUTO")}
        · ${esc(t.guest_count || 1)} guest(s)
        · ${esc(t.vehicles?.vehicle_no || "Unassigned")}
        · ${esc(t.drivers?.name || t.drivers?.employee_no || "No driver")}
      </div>
    </article>
  `).join("") : `<div class="empty">No trips for today.</div>`;

  $("tripBoard").innerHTML = html;

  const priority = trips.filter(t =>
    ["PENDING","AUTO_DISPATCHING","ASSIGNED","ACCEPTED","TO_PICKUP","ARRIVED"].includes(t.status)
  ).slice(0,8);

  $("priorityTrips").innerHTML = priority.length
    ? priority.map(t => `
      <article class="trip-card ${["VIP","VVIP","CHAIRMAN"].includes(t.vip_level) ? "vip":""}">
        <div class="trip-top">
          <div>
            <div class="trip-time">${esc(fmtTime(t.pickup_time))} · ${esc(t.vip_level || "STANDARD")}</div>
            <div class="trip-meta">${esc(t.guest_name || "Guest")} · ${esc(t.booking_no)}</div>
          </div>
          <span class="status">${esc(t.status)}</span>
        </div>
        <div class="trip-route">${esc(t.pickup_location)} → ${esc(t.destination)}</div>
        <div class="trip-meta">${esc(t.vehicles?.vehicle_no || "Awaiting dispatch")} · ${esc(t.drivers?.name || "No driver")}</div>
      </article>
    `).join("")
    : `<div class="empty">No priority trips.</div>`;

  $("statPending").textContent = trips.filter(t => ["PENDING","AUTO_DISPATCHING"].includes(t.status)).length;
  $("statAssigned").textContent = trips.filter(t => ["ASSIGNED","ACCEPTED","TO_PICKUP","ARRIVED"].includes(t.status)).length;
  $("statOnTrip").textContent = trips.filter(t => t.status === "GUEST_ON_BOARD").length;
}

function renderFleet(vehicles){
  $("statAvailable").textContent = vehicles.filter(v => v.status === "AVAILABLE").length;

  $("fleetBoard").innerHTML = vehicles.length
    ? vehicles.map(v => `
      <article class="fleet-card">
        <div class="fleet-top">
          <div>
            <strong>${esc(v.vehicle_no)}</strong>
            <div class="fleet-meta">${esc(v.vehicle_type)} · ${esc(v.seat_capacity ?? "—")} seats</div>
          </div>
          <span class="status ${v.status === "AVAILABLE" ? "available":""}">${esc(v.status)}</span>
        </div>
      </article>
    `).join("")
    : `<div class="empty">No vehicle data.</div>`;
}

async function refreshAll(){
  try{
    const [trips, fleet] = await Promise.all([loadBookings(), loadFleet()]);
    renderTrips(trips);
    renderFleet(fleet);
  }catch(err){
    console.error(err);
    $("priorityTrips").innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

$("bookingForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  showMessage($("bookingMessage"), "Creating...");

  try{
    const local = $("pickupTime").value;
    if(!local) throw new Error("Pickup time is required.");

    const payload = {
      booking_no: bookingNo(),
      booking_source: "CONCIERGE",
      booking_type: "HOTEL_GUEST",
      guest_name: $("guestName").value.trim(),
      room_no: $("roomNo").value.trim() || null,
      guest_count: Number($("guestCount").value || 1),
      luggage_count: Number($("luggageCount").value || 0),
      vip_level: $("vipLevel").value,
      pickup_time: new Date(local).toISOString(),
      pickup_location: $("pickupLocation").value.trim(),
      destination: $("destination").value.trim(),
      required_vehicle_type: $("vehicleType").value || null,
      status: "PENDING",
      special_request: $("specialRequest").value.trim() || null
    };

    const { error } = await client.from("bookings").insert(payload);
    if(error) throw error;

    showMessage(
      $("bookingMessage"),
      "Booking created. Map coordinates will be added in the next version.",
      "ok"
    );

    $("bookingForm").reset();
    $("guestCount").value = 1;
    $("luggageCount").value = 0;
    await refreshAll();
  }catch(err){
    showMessage($("bookingMessage"), err.message, "error");
  }
});

client?.auth.onAuthStateChange((_event, session) => {
  if(!session) setView("login");
});

boot();
