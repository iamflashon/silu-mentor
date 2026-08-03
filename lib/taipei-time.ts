const TAIPEI_TIME_ZONE = "Asia/Taipei";

function parts(date = new Date()) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(values.filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
}

export function taipeiDate(date = new Date()) {
  const value = parts(date);
  return `${value.year}-${value.month}-${value.day}`;
}

export function taipeiMonth(date = new Date()) {
  return taipeiDate(date).slice(0, 7);
}

export function taipeiHour(date = new Date()) {
  return Number(parts(date).hour);
}

export function taipeiGreeting(date = new Date()) {
  const hour = taipeiHour(date);
  if (hour >= 5 && hour < 12) return "早安";
  if (hour >= 12 && hour < 18) return "午安";
  return "晚安";
}

