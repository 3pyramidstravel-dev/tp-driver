/* ==========================================================================
   Prices — effective-dated history + the agreed calculation rules
   Every price change is a new history entry with a start date, so months
   already invoiced keep the price they were billed with.
   ========================================================================== */
(function (TP) {
  'use strict';

  /** The entry in force on `day` ('YYYY-MM-DD'): the latest one whose `from` <= day. */
  TP.rateAt = function (history, day) {
    if (!Array.isArray(history) || !history.length) return null;
    const d = day || TP.dayKey();
    let best = null;
    history.forEach(h => { if (h && h.from && h.from <= d && (!best || h.from > best.from || (h.from === best.from && (h.setAt || 0) > (best.setAt || 0)))) best = h; });
    return best;
  };

  /** Adds an entry; a second entry on the same start date replaces the first. */
  TP.addRate = function (history, entry) {
    const list = (Array.isArray(history) ? history : []).filter(h => h.from !== entry.from);
    list.push(entry);
    return list.sort((a, b) => (a.from < b.from ? -1 : 1));
  };

  const r2 = n => Math.round(n * 100) / 100;
  TP.round2 = r2;

  /**
   * Calculation rules (agreed with the GM):
   *  - Morning only = half day (50%); morning + evening = full day. Only worked days count.
   *  - Factory evening wait: per minute = hourly price / 60, from "arrived evening" to "moved evening".
   *  - Overtime: 3 tiers (≤ 21:00, ≤ 23:00, 23:00–24:00), price per tier, needs management approval.
   *  - Airport: the trip includes the first 60 min of waiting; after that any part of an hour = a full hour.
   *  - Profit report: tax = 3% of total factory invoices; net = invoices − driver pay − tax.
   */
  TP.calc = {
    dayAmount(lineDay, part) { return part === 'full' ? r2(lineDay) : part === 'half' ? r2(lineDay / 2) : 0; },
    waitAmount(minutes, perHour) { return r2(Math.max(0, minutes) * (Number(perHour) || 0) / 60); },
    perMinute(perHour) { return r2((Number(perHour) || 0) / 60); },
    overtimeAmount(tier, tiers) { return tier >= 1 && tier <= 3 && Array.isArray(tiers) ? r2(Number(tiers[tier - 1]) || 0) : 0; },
    airportExtraHours(waitMinutes, freeMinutes) {
      const extra = Math.max(0, waitMinutes - (freeMinutes ?? 60));
      return extra > 0 ? Math.ceil(extra / 60) : 0;
    },
    tax(invoicesTotal, pct) { return r2(invoicesTotal * (pct ?? 3) / 100); },
    netProfit(invoicesTotal, driverPay, pct) { return r2(invoicesTotal - driverPay - TP.calc.tax(invoicesTotal, pct)); }
  };
})(window.TP = window.TP || {});
