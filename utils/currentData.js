exports.currentDate = () => {
  let currentDate = new Date();

  // Convert server time to Asia/Colombo (UTC+5:30)
  let options = {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  };

  let formatter = new Intl.DateTimeFormat("en-GB", options);
  let parts = formatter.formatToParts(currentDate);

  let year = parts.find(p => p.type === "year").value;
  let month = parts.find(p => p.type === "month").value;
  let day = parts.find(p => p.type === "day").value;
  let hour = parts.find(p => p.type === "hour").value;
  let minute = parts.find(p => p.type === "minute").value;

  return `${year}-${month}-${day} ${hour}:${minute}`;
};

exports.currentDateTime = () => {
  let currentDate = new Date();

  // Convert server time to Asia/Colombo (UTC+5:30)
  let options = {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  };

  let formatter = new Intl.DateTimeFormat("en-GB", options);
  let parts = formatter.formatToParts(currentDate);

  let year = parts.find(p => p.type === "year").value;
  let month = parts.find(p => p.type === "month").value;
  let day = parts.find(p => p.type === "day").value;
  let hour = parts.find(p => p.type === "hour").value;
  let minute = parts.find(p => p.type === "minute").value;
  let second = parts.find(p => p.type === "second").value;

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

/**
 * Ensures a date/time string has both date and time in Asia/Colombo.
 * - If inputDate is null/undefined/empty: returns current Colombo datetime.
 * - If inputDate is a Date instance: formats to Colombo datetime string.
 * - If inputDate is "YYYY-MM-DD": appends current Colombo time ("HH:mm:ss").
 * - If inputDate has "00:00:00" or "00:00" as time: replaces with current Colombo time.
 * - If inputDate has a valid non-zero time: preserves it ("YYYY-MM-DD HH:mm:ss").
 */
exports.resolveDateTime = (inputDate) => {
  const colomboNow = exports.currentDateTime(); // "YYYY-MM-DD HH:mm:ss"
  const currentTime = colomboNow.split(" ")[1]; // "HH:mm:ss"

  if (!inputDate) {
    return colomboNow;
  }

  let str = "";
  if (inputDate instanceof Date) {
    if (isNaN(inputDate.getTime())) {
      return colomboNow;
    }
    const options = {
      timeZone: "Asia/Colombo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    };
    const formatter = new Intl.DateTimeFormat("en-GB", options);
    const parts = formatter.formatToParts(inputDate);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    const h = parts.find((p) => p.type === "hour")?.value;
    const min = parts.find((p) => p.type === "minute")?.value;
    const s = parts.find((p) => p.type === "second")?.value;
    str = `${y}-${m}-${d} ${h}:${min}:${s}`;
  } else {
    str = String(inputDate).trim();
  }

  if (!str) {
    return colomboNow;
  }

  // Normalize 'T' or ISO or trailing 'Z'
  str = str.replace("T", " ").replace("Z", "").split(".")[0].trim();

  // If format is strictly "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return `${str} ${currentTime}`;
  }

  // If format is "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD HH:mm"
  const match = str.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const datePart = match[1];
    const hour = match[2];
    const minute = match[3];
    const second = match[4] || "00";

    // If time is 00:00:00 (or 00:00), replace with current Colombo time
    if (hour === "00" && minute === "00" && (second === "00" || !match[4])) {
      return `${datePart} ${currentTime}`;
    }

    return `${datePart} ${hour}:${minute}:${second}`;
  }

  return colomboNow;
};
