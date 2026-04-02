export interface ItemProfitInput {
  ilosc: number;
  cena_netto: number;
  wartosc_netto: number;
  cena_zakupu: number | null;
}

export interface ItemProfitResult {
  koszt_calkowity: number | null;
  zysk: number | null;
  marza_procent: number | null;
}

export interface InvoiceProfitInput {
  items: Array<{
    zysk: number;
    marza_procent: number;
  }>;
  koszt_logistyki: number;
  netto: number;
}

export interface InvoiceProfitResult {
  zysk_calkowity: number | null;
  marza_calkowita: number | null;
}

/**
 * Calculate profit for a single invoice item
 */
export function calculateItemProfit(input: ItemProfitInput): ItemProfitResult {
  const { ilosc, wartosc_netto, cena_zakupu } = input;

  // If no purchase price, can't calculate profit
  if (cena_zakupu === null || cena_zakupu === undefined) {
    return {
      koszt_calkowity: null,
      zysk: null,
      marza_procent: null
    };
  }

  const koszt_calkowity = ilosc * cena_zakupu;
  const zysk = wartosc_netto - koszt_calkowity;
  const marza_procent = wartosc_netto > 0 ? (zysk / wartosc_netto) * 100 : 0;

  return {
    koszt_calkowity: Math.round(koszt_calkowity * 100) / 100,
    zysk: Math.round(zysk * 100) / 100,
    marza_procent: Math.round(marza_procent * 100) / 100
  };
}

/**
 * Calculate total profit for an invoice
 */
export function calculateInvoiceProfit(input: InvoiceProfitInput): InvoiceProfitResult {
  const { items, koszt_logistyki, netto } = input;

  // Sum up profit from all items
  const zyskZPozycji = items.reduce((sum, item) => sum + (item.zysk || 0), 0);

  // Subtract logistics cost
  const zysk_calkowity = zyskZPozycji - koszt_logistyki;

  // Calculate overall margin
  const marza_calkowita = netto > 0 ? (zysk_calkowity / netto) * 100 : 0;

  return {
    zysk_calkowity: Math.round(zysk_calkowity * 100) / 100,
    marza_calkowita: Math.round(marza_calkowita * 100) / 100
  };
}

/**
 * Calculate invoice totals from items
 */
export function calculateInvoiceTotals(items: Array<{
  wartosc_netto: number;
  wartosc_vat: number;
  wartosc_brutto: number;
}>): {
  netto: number;
  vat: number;
  brutto: number;
} {
  return items.reduce((totals, item) => ({
    netto: totals.netto + (item.wartosc_netto || 0),
    vat: totals.vat + (item.wartosc_vat || 0),
    brutto: totals.brutto + (item.wartosc_brutto || 0)
  }), { netto: 0, vat: 0, brutto: 0 });
}
