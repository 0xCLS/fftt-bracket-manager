/* Public, aggregate-only counter. Never request registration rows from a visitor's browser. */
(() => {
  const number = document.getElementById('registration-count');
  const updated = document.getElementById('registration-count-updated');
  if (!number || !updated) return;
  const urls = [
    'https://raw.githubusercontent.com/0xCLS/fftt-bracket-manager/main/public-site/data/registration-count.json',
    './data/registration-count.json'
  ];
  const formatDate = (date) => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  async function refresh() {
    for (const url of urls) {
      try {
        const res = await fetch(url, {cache: 'no-store'});
        if (!res.ok) continue;
        const obj = await res.json();
        if (obj.eventDate !== '2026-11-22' || !Number.isSafeInteger(obj.count) || obj.count < 1 || obj.count > 2000 || !/^\d{4}-\d{2}-\d{2}$/.test(obj.verifiedDate)) continue;
        number.textContent = obj.count.toLocaleString('en-US');
        updated.textContent = 'As of ' + formatDate(obj.verifiedDate);
        return;
      } catch { /* Retain the last verified figure if the update cannot be reached. */ }
    }
  }
  refresh();
  setInterval(refresh, 60 * 60 * 1000);
})();