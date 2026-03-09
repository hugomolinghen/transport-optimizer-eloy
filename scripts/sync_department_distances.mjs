const SUPABASE_URL = "https://eayhqksztfhyxqhrrnkk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVheWhxa3N6dGZoeXhxaHJybmtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxOTQwMzksImV4cCI6MjA3Nzc3MDAzOX0.AsWKSQDa9MDpsmvP6i4LOwBJevQfzUyImzt2_8D-o18";
const OPENROUTESERVICE_API_KEY =
  "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6Ijc0ODM1ZTU2MzJkYjQyOGY4ZGRjNmFhMjYxN2ZhYjM3IiwiaCI6Im11cm11cjY0In0=";

const SPRIMONT = { lat: 50.5333, lon: 5.6203 };
const ORS_CHUNK_SIZE = 49;

const supabaseHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

const parseCoord = (value) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

async function fetchDepartments() {
  const select = [
    "id",
    "km",
    "distance",
    "latitude",
    "lat",
    "lat_geographique",
    "lat_geo",
    "longitude",
    "long",
    "lng",
    "lon",
    "long_geographique",
    "long_geo",
  ].join(",");

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/departements?select=${encodeURIComponent(select)}`,
    { headers: supabaseHeaders }
  );

  if (!response.ok) {
    throw new Error(`Supabase select failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function getDistancesForChunk(chunk) {
  const locations = [
    [SPRIMONT.lon, SPRIMONT.lat],
    ...chunk.map((dept) => [dept.longitude, dept.latitude]),
  ];

  const response = await fetch("https://api.openrouteservice.org/v2/matrix/driving-hgv", {
    method: "POST",
    headers: {
      Authorization: OPENROUTESERVICE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      locations,
      metrics: ["distance"],
      units: "km",
    }),
  });

  if (!response.ok) {
    throw new Error(`ORS matrix failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  if (!Array.isArray(data?.distances) || !Array.isArray(data.distances[0])) {
    throw new Error("ORS matrix returned invalid distances payload");
  }

  return data.distances[0].slice(1);
}

async function updateDepartmentKm(id, km, useDistanceColumn) {
  const body = useDistanceColumn ? { distance: km } : { km };
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/departements?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        ...supabaseHeaders,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(`Supabase update failed for id ${id}: ${response.status} ${await response.text()}`);
  }
}

async function main() {
  const rows = await fetchDepartments();
  const departments = rows
    .map((row) => {
      const latitude =
        parseCoord(row.latitude) ??
        parseCoord(row.lat) ??
        parseCoord(row.lat_geographique) ??
        parseCoord(row.lat_geo);
      const longitude =
        parseCoord(row.longitude) ??
        parseCoord(row.long) ??
        parseCoord(row.lng) ??
        parseCoord(row.lon) ??
        parseCoord(row.long_geographique) ??
        parseCoord(row.long_geo);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

      return { id: row.id, latitude, longitude };
    })
    .filter(Boolean);

  if (!departments.length) {
    console.log("No departments with coordinates found.");
    return;
  }

  const useDistanceColumn = !Object.prototype.hasOwnProperty.call(rows[0] || {}, "km");
  let updated = 0;

  for (let index = 0; index < departments.length; index += ORS_CHUNK_SIZE) {
    const chunk = departments.slice(index, index + ORS_CHUNK_SIZE);
    const distances = await getDistancesForChunk(chunk);

    for (let i = 0; i < chunk.length; i += 1) {
      const km = Number(Number(distances[i]).toFixed(1));
      if (!Number.isFinite(km)) continue;
      await updateDepartmentKm(chunk[i].id, km, useDistanceColumn);
      updated += 1;
      console.log(`Updated department ${chunk[i].id} -> ${km} km`);
    }
  }

  console.log(`Done. Updated ${updated} departments.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
