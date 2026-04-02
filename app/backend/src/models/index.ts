export interface Customer {
  id: number;
  nazwa: string;
  nip: string | null;
  ulica: string | null;
  kod_pocztowy: string | null;
  miasto: string | null;
  kraj: string;
  email: string | null;
  telefon: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Product {
  id: number;
  sku: string | null;
  gtin: string | null;
  nazwa: string;
  cena_zakupu: number | null;
  cena_sprzedazy_rekomendowana: number | null;
  stawka_vat: number | null;
  kategoria: string | null;
  jednostka: string | null;
  stan_magazynowy: number | null;
  additional_info: string | null;
  aktywny: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface InvoiceItem {
  id: number;
  invoice_id: number;
  product_id: number | null;
  lp: number | null;
  nazwa: string;
  ilosc: number;
  jednostka: string | null;
  cena_netto: number | null;
  stawka_vat: number | null;
  wartosc_netto: number | null;
  wartosc_vat: number | null;
  wartosc_brutto: number | null;
  cena_zakupu: number | null;
  koszt_calkowity: number | null;
  zysk: number | null;
  marza_procent: number | null;
  is_shipping: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Invoice {
  id: number;
  numer_faktury: string;
  customer_id: number;
  data_wystawienia: Date | null;
  data_sprzedazy: Date | null;
  termin_platnosci: Date | null;
  forma_platnosci: string | null;
  waluta: string;
  kurs_waluty: number;
  netto: number | null;
  vat: number | null;
  brutto: number | null;
  zaplacono: number;
  status_platnosci: 'oplacona' | 'nieoplacona' | 'czesciowa' | 'zwrot';
  opiekun: string | null;
  koszt_logistyki: number | null;
  zysk: number | null;
  marza_procent: number | null;
  pdf_path: string | null;
  uwagi: string | null;
  created_at: Date;
  updated_at: Date;
  items?: InvoiceItem[];
  customer?: Customer;
}

export interface ParsedInvoice {
  numerFaktury: string;
  dataWystawienia: Date;
  dataSprzedazy: Date;
  terminPlatnosci: Date;
  formaPlatnosci: string;
  nabywca: {
    nazwa: string;
    nip: string | null;
    ulica: string;
    kodPocztowy: string;
    miasto: string;
  };
  pozycje: Array<{
    lp: number;
    nazwa: string;
    ilosc: number;
    jednostka: string;
    stawkaVat: number;
    cenaNetto: number;
    wartoscNetto: number;
  }>;
  podsumowanie: {
    netto: number;
    vat: number;
    brutto: number;
    zaplacono: number;
    pozostaje: number;
  };
}
