const state = {
  data: null,
  cityKey: null,
  date: null,
  marketSlug: null,
};

const colors = {
  polymarket: "#2563eb",
  model: "#0f766e",
};

async function boot() {
  const response = await fetch("assets/data.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load data: ${response.status}`);
  state.data = await response.json();
  const firstEvent = state.data.events[0];
  state.cityKey = firstEvent?.cityKey;
  state.date = firstEvent?.date;
  state.marketSlug = firstEvent?.brackets[0]?.marketSlug;
  renderSelectors();
  render();
}

function renderSelectors() {
  const citySelect = document.querySelector("#citySelect");
  const dateSelect = document.querySelector("#dateSelect");
  const bracketSelect = document.querySelector("#bracketSelect");

  citySelect.innerHTML = "";
  for (const city of state.data.cities) {
    if (!eventsForCity(city.key).length) continue;
    citySelect.append(new Option(`${city.name} (${city.station})`, city.key));
  }
  citySelect.value = state.cityKey;
  citySelect.onchange = () => {
    state.cityKey = citySelect.value;
    state.date = datesForCity(state.cityKey)[0];
    state.marketSlug = selectedEvent()?.brackets[0]?.marketSlug;
    renderSelectors();
    render();
  };

  dateSelect.innerHTML = "";
  for (const date of datesForCity(state.cityKey)) {
    dateSelect.append(new Option(date, date));
  }
  dateSelect.value = state.date;
  dateSelect.onchange = () => {
    state.date = dateSelect.value;
    state.marketSlug = selectedEvent()?.brackets[0]?.marketSlug;
    renderSelectors();
    render();
  };

  bracketSelect.innerHTML = "";
  for (const bracket of selectedEvent()?.brackets || []) {
    bracketSelect.append(new Option(`${bracket.label} (${pct(bracket.latestPolymarketPrice)})`, bracket.marketSlug));
  }
  bracketSelect.value = state.marketSlug;
  bracketSelect.onchange = () => {
    state.marketSlug = bracketSelect.value;
    render();
  };
}

function render() {
  const event = selectedEvent();
  const series = state.data.series[state.marketSlug];
  if (!event || !series) return;
  document.querySelector("#generatedAt").textContent = `Generated ${formatGeneratedTime(state.data.generatedAt)}`;
  renderSummary(event, series);
  renderSources();
  renderLegend("#probLegend", [
    ["Polymarket", colors.polymarket],
    ["Our model", colors.model],
  ]);
  renderProbabilityChart(series);
  renderTable(series);
}

function eventsForCity(cityKey) {
  return state.data.events.filter((event) => event.cityKey === cityKey);
}

function datesForCity(cityKey) {
  return eventsForCity(cityKey).map((event) => event.date).sort();
}

function selectedEvent() {
  return state.data.events.find((event) => event.cityKey === state.cityKey && event.date === state.date);
}

function renderSummary(event, series) {
  const city = state.data.cities.find((item) => item.key === event.cityKey);
  const latestMarket = latestValue(series.polymarketLine);
  const latestModel = latestValue(series.modelLine);
  const edge = Number.isFinite(latestModel) && Number.isFinite(latestMarket) ? latestModel - latestMarket : null;
  const resolved = series.resolvedYes === null ? "Pending" : series.resolvedYes ? "YES" : "NO";
  const metrics = [
    ["Market", series.label, `${event.station} · ${event.date}`],
    ["Polymarket", pct(latestMarket), "YES price"],
    ["Our Model", pct(latestModel), "YES probability"],
    ["Model Edge", signedPct(edge), edge == null ? "Waiting for both lines" : edge > 0 ? "Model above market" : "Model below market"],
    ["Official High", temp(event.actualTmaxF), event.actualTmaxF == null ? "Final pending" : resolved],
  ];
  document.querySelector("#summary").innerHTML = metrics
    .map(
      ([label, value, small]) => `
        <div class="metric">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${escapeHtml(value)}</div>
          <div class="small">${escapeHtml(small)}</div>
        </div>
      `,
    )
    .join("");
}

function renderSources() {
  document.querySelector("#sourceLinks").innerHTML = state.data.sources
    .map((source) => `<a href="${source.url}">${escapeHtml(source.name)}</a>`)
    .join(" · ");
}

function renderLegend(selector, items) {
  document.querySelector(selector).innerHTML = items
    .map(([label, color]) => `<span class="legend-item"><span class="swatch" style="background:${color}"></span>${label}</span>`)
    .join("");
}

function renderProbabilityChart(series) {
  drawProbabilityChart({
    selector: "#probChart",
    marketLine: series.polymarketLine,
    modelLine: series.modelLine,
  });
}

function drawProbabilityChart({ selector, marketLine, modelLine }) {
  const svg = document.querySelector(selector);
  svg.innerHTML = "";
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 320;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const margin = { top: 18, right: 18, bottom: 34, left: 46 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const allPoints = [...marketLine, ...modelLine].filter((point) => Number.isFinite(point.p));
  if (!allPoints.length) {
    text(svg, width / 2, height / 2, "No market/model data available yet", "empty", "middle");
    return;
  }

  const times = allPoints.map((point) => new Date(point.t).getTime()).filter(Number.isFinite);
  const minX = Math.min(...times);
  const maxX = Math.max(...times);
  const x = (time) => margin.left + ((new Date(time).getTime() - minX) / Math.max(maxX - minX, 1)) * innerW;
  const y = (value) => margin.top + (1 - value) * innerH;

  for (let i = 0; i <= 4; i += 1) {
    const yy = margin.top + (innerH * i) / 4;
    line(svg, margin.left, yy, width - margin.right, yy, "grid");
    text(svg, 8, yy + 4, `${100 - i * 25}%`, "tick");
  }
  line(svg, margin.left, margin.top, margin.left, height - margin.bottom, "axis");
  line(svg, margin.left, height - margin.bottom, width - margin.right, height - margin.bottom, "axis");

  const tickCount = 5;
  const sorted = allPoints.slice().sort((a, b) => new Date(a.t) - new Date(b.t));
  for (let i = 0; i < tickCount; i += 1) {
    const point = sorted[Math.floor((i * (sorted.length - 1)) / Math.max(tickCount - 1, 1))];
    text(svg, x(point.t), height - 10, shortTraceTime(point.t), "tick", "middle");
  }

  const marketPath = pathFor(marketLine, x, y);
  if (marketPath) path(svg, marketPath, colors.polymarket, "line");
  const modelPath = pathFor(modelLine, x, y);
  if (modelPath) path(svg, modelPath, colors.model, "line");
}

function pathFor(points, x, y) {
  const parts = [];
  let open = false;
  for (const point of points) {
    if (!Number.isFinite(point.p)) {
      open = false;
      continue;
    }
    parts.push(`${open ? "L" : "M"}${x(point.t).toFixed(2)},${y(point.p).toFixed(2)}`);
    open = true;
  }
  return parts.join(" ");
}

function renderTable(series) {
  const rows = combinedRows(series).slice(-14).reverse();
  document.querySelector("#updatesBody").innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(formatTraceTime(row.t))}</td>
          <td>${escapeHtml(pct(row.market))}</td>
          <td>${escapeHtml(pct(row.model))}</td>
          <td>${escapeHtml(signedPct(row.edge))}</td>
        </tr>
      `,
    )
    .join("");
}

function combinedRows(series) {
  const model = series.modelLine || [];
  const market = series.polymarketLine || [];
  return model.map((point) => {
    const marketPoint = nearestPoint(market, point.t);
    const marketValue = marketPoint?.p ?? null;
    return {
      t: point.t,
      model: point.p,
      market: marketValue,
      edge: Number.isFinite(point.p) && Number.isFinite(marketValue) ? point.p - marketValue : null,
    };
  });
}

function nearestPoint(points, time) {
  if (!points.length) return null;
  const target = new Date(time).getTime();
  let best = points[0];
  let bestDiff = Math.abs(new Date(best.t).getTime() - target);
  for (const point of points) {
    const diff = Math.abs(new Date(point.t).getTime() - target);
    if (diff < bestDiff) {
      best = point;
      bestDiff = diff;
    }
  }
  return best;
}

function latestValue(points) {
  const value = points?.slice().reverse().find((point) => Number.isFinite(point.p))?.p;
  return Number.isFinite(value) ? value : null;
}

function path(svg, d, stroke, className) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
  node.setAttribute("d", d);
  node.setAttribute("stroke", stroke);
  node.setAttribute("class", className);
  svg.append(node);
}

function line(svg, x1, y1, x2, y2, className) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "line");
  node.setAttribute("x1", x1);
  node.setAttribute("y1", y1);
  node.setAttribute("x2", x2);
  node.setAttribute("y2", y2);
  node.setAttribute("class", className);
  svg.append(node);
}

function text(svg, x, y, value, className, anchor = "start") {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
  node.setAttribute("x", x);
  node.setAttribute("y", y);
  node.setAttribute("class", className);
  node.setAttribute("text-anchor", anchor);
  node.textContent = value;
  svg.append(node);
}

function formatGeneratedTime(value) {
  if (!value) return "NA";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTraceTime(value) {
  const parsed = parseIsoLocalParts(value);
  if (!parsed) return "NA";
  return `${parsed.month} ${parsed.day}, ${formatHour(parsed.hour, parsed.minute)}`;
}

function shortTraceTime(value) {
  const parsed = parseIsoLocalParts(value);
  if (!parsed) return "NA";
  return formatHour(parsed.hour, parsed.minute);
}

function parseIsoLocalParts(value) {
  const match = String(value).match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return {
    month: monthNames[Number(match[1]) - 1],
    day: Number(match[2]),
    hour: Number(match[3]),
    minute: Number(match[4]),
  };
}

function formatHour(hour24, minute) {
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function temp(value) {
  return Number.isFinite(value) ? `${Math.round(value)}F` : "Pending";
}

function pct(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "Pending";
}

function signedPct(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%` : "Pending";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

boot().catch((error) => {
  document.body.innerHTML = `<main><section class="chart-panel"><h2>Dashboard Error</h2><p>${escapeHtml(error.message)}</p></section></main>`;
});
