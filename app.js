const state = {
  data: null,
  cityKey: null,
  date: null,
};

const colors = {
  observedTempF: "#2563eb",
  highSoFarF: "#b45309",
  modelFinalHighF: "#0f766e",
  forecastTempF: "#64748b",
  yesProb: "#0f766e",
};

async function boot() {
  const response = await fetch("assets/data.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load data: ${response.status}`);
  state.data = await response.json();
  state.cityKey = state.data.markets[0]?.cityKey;
  state.date = state.data.markets[0]?.date;
  renderSelectors();
  render();
}

function renderSelectors() {
  const citySelect = document.querySelector("#citySelect");
  const dateSelect = document.querySelector("#dateSelect");
  citySelect.innerHTML = "";
  for (const city of state.data.cities) {
    const hasMarket = state.data.markets.some((market) => market.cityKey === city.key);
    if (!hasMarket) continue;
    citySelect.append(new Option(`${city.name} (${city.station})`, city.key));
  }
  citySelect.value = state.cityKey;
  citySelect.addEventListener("change", () => {
    state.cityKey = citySelect.value;
    const dates = marketDatesForCity(state.cityKey);
    state.date = dates[0];
    renderSelectors();
    render();
  });

  dateSelect.innerHTML = "";
  for (const date of marketDatesForCity(state.cityKey)) {
    dateSelect.append(new Option(date, date));
  }
  dateSelect.value = state.date;
  dateSelect.addEventListener("change", () => {
    state.date = dateSelect.value;
    render();
  });
}

function render() {
  const market = selectedMarket();
  const series = state.data.series[market.key];
  document.querySelector("#generatedAt").textContent = `Generated ${formatGeneratedTime(state.data.generatedAt)}`;
  renderSummary(market, series);
  renderSources();
  renderLegend("#tempLegend", [
    ["Observed", colors.observedTempF],
    ["High so far", colors.highSoFarF],
    ["Model final high", colors.modelFinalHighF],
    ["Forecast temp", colors.forecastTempF],
  ]);
  renderLegend("#probLegend", [["YES probability", colors.yesProb]]);
  renderTempChart(series);
  renderProbabilityChart(series);
  renderTable(series);
}

function selectedMarket() {
  return state.data.markets.find((market) => market.cityKey === state.cityKey && market.date === state.date);
}

function marketDatesForCity(cityKey) {
  return state.data.markets
    .filter((market) => market.cityKey === cityKey)
    .map((market) => market.date)
    .sort();
}

function renderSummary(market, series) {
  const city = state.data.cities.find((item) => item.key === market.cityKey);
  const latest = series.points.at(-1) || {};
  const resolved = market.resolvedYes === null ? "Pending" : market.resolvedYes ? "YES" : "NO";
  const metrics = [
    ["Market Rule", market.rule, `${market.station} · ${market.date}`],
    ["YES Probability", pct(latest.yesProb), series.dataMode === "forecast_only" ? "Forecast only" : "Live/replay trace"],
    ["Model Final High", temp(latest.modelFinalHighF ?? market.basePredictedTmaxF), `Baseline forecast ${temp(market.forecastTmaxF)}`],
    ["Observed High", temp(latest.highSoFarF), market.actualTmaxF == null ? "Official final pending" : `Official ${temp(market.actualTmaxF)} · ${resolved}`],
    ["Station", city.station, city.notes],
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

function renderTempChart(series) {
  const market = selectedMarket();
  drawChart({
    selector: "#tempChart",
    points: series.points,
    yKeys: ["observedTempF", "highSoFarF", "modelFinalHighF", "forecastTempF"],
    yFormat: (value) => `${Math.round(value)}F`,
    yDomain: temperatureDomain(series.points, market),
    rule: { low: market.lowF, high: market.highF },
  });
}

function renderProbabilityChart(series) {
  drawChart({
    selector: "#probChart",
    points: series.points,
    yKeys: ["yesProb"],
    yFormat: (value) => `${Math.round(value * 100)}%`,
    yDomain: [0, 1],
  });
}

function drawChart({ selector, points, yKeys, yFormat, yDomain, rule }) {
  const svg = document.querySelector(selector);
  svg.innerHTML = "";
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 320;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const margin = { top: 18, right: 18, bottom: 34, left: 46 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  if (!points.length) {
    text(svg, width / 2, height / 2, "No time-series data available yet", "empty", "middle");
    return;
  }

  const times = points.map((point) => new Date(point.t).getTime()).filter(Number.isFinite);
  const minX = Math.min(...times);
  const maxX = Math.max(...times);
  const [minY, maxY] = yDomain;
  const x = (time) => margin.left + ((new Date(time).getTime() - minX) / Math.max(maxX - minX, 1)) * innerW;
  const y = (value) => margin.top + (1 - (value - minY) / Math.max(maxY - minY, 1)) * innerH;

  for (let i = 0; i <= 4; i += 1) {
    const yy = margin.top + (innerH * i) / 4;
    line(svg, margin.left, yy, width - margin.right, yy, "grid");
    const value = maxY - ((maxY - minY) * i) / 4;
    text(svg, 8, yy + 4, yFormat(value), "tick");
  }

  if (rule && (rule.low != null || rule.high != null)) {
    if (rule.low != null && rule.high != null) {
      const top = y(rule.high + 0.5);
      const bottom = y(rule.low - 0.5);
      rect(svg, margin.left, top, innerW, bottom - top, "rule-band");
    } else if (rule.high != null) {
      line(svg, margin.left, y(rule.high + 0.5), width - margin.right, y(rule.high + 0.5), "rule-line");
    }
  }

  line(svg, margin.left, margin.top, margin.left, height - margin.bottom, "axis");
  line(svg, margin.left, height - margin.bottom, width - margin.right, height - margin.bottom, "axis");

  const tickCount = Math.min(5, points.length);
  for (let i = 0; i < tickCount; i += 1) {
    const point = points[Math.floor((i * (points.length - 1)) / Math.max(tickCount - 1, 1))];
    const xx = x(point.t);
    text(svg, xx, height - 10, shortTraceTime(point.t), "tick", "middle");
  }

  for (const key of yKeys) {
    const pathData = pathFor(points, key, x, y);
    if (!pathData) continue;
    path(svg, pathData, colors[key], "line");
  }
}

function temperatureDomain(points, market) {
  const values = [];
  for (const point of points) {
    for (const key of ["observedTempF", "highSoFarF", "modelFinalHighF", "forecastTempF"]) {
      if (Number.isFinite(point[key])) values.push(point[key]);
    }
  }
  if (market.lowF != null) values.push(market.lowF - 2);
  if (market.highF != null) values.push(market.highF + 2);
  if (!values.length) return [50, 100];
  const min = Math.floor(Math.min(...values) - 2);
  const max = Math.ceil(Math.max(...values) + 2);
  return [min, max];
}

function pathFor(points, key, x, y) {
  const parts = [];
  let open = false;
  for (const point of points) {
    const value = point[key];
    if (!Number.isFinite(value)) {
      open = false;
      continue;
    }
    parts.push(`${open ? "L" : "M"}${x(point.t).toFixed(2)},${y(value).toFixed(2)}`);
    open = true;
  }
  return parts.join(" ");
}

function renderTable(series) {
  const rows = series.points.slice(-14).reverse();
  document.querySelector("#updatesBody").innerHTML = rows
    .map(
      (point) => `
        <tr>
          <td>${escapeHtml(formatTraceTime(point.t))}</td>
          <td>${escapeHtml(temp(point.observedTempF))}</td>
          <td>${escapeHtml(temp(point.highSoFarF))}</td>
          <td>${escapeHtml(temp(point.modelFinalHighF))}</td>
          <td>${escapeHtml(pct(point.yesProb))}</td>
          <td>${escapeHtml(wind(point))}</td>
        </tr>
      `,
    )
    .join("");
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

function rect(svg, x, y, width, height, className) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  node.setAttribute("x", x);
  node.setAttribute("y", y);
  node.setAttribute("width", width);
  node.setAttribute("height", Math.max(height, 0));
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

function wind(point) {
  if (!Number.isFinite(point.windDir) || !Number.isFinite(point.windMph)) return "NA";
  return `${Math.round(point.windDir)} deg @ ${Math.round(point.windMph)} mph`;
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
