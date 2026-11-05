/*
 * Bahasa Indonesia text for the policy handbook and the Annex B / Annex C agreements (Policy v4.0).
 *
 * The Bahasa Indonesia version of the policy prevails over the English (Document control; Law 24/2009 requires
 * Indonesian for agreements with Indonesian employees). §15.2: the full BI version is prepared with the legal review in
 * November 2026. Until HR publishes it, this module carries the BI section titles and the full BI text of the two
 * documents employees sign (Annex B and Annex C), so the e-signature can be given in Bahasa Indonesia.
 * Status: working translation for review by Indonesian labour counsel (HR).
 */

export type PolicyLang = "en" | "id";

export const BI_STATUS = "Terjemahan kerja — ditinjau oleh konsultan hukum ketenagakerjaan (§15.2)";

export const DOC_TITLE_ID = "Kebijakan Inisiatif Proyek dan Kompensasi";

/** Bahasa Indonesia titles of the top-level sections and annexes, by anchor id. */
export const SECTION_TITLES_ID: Record<string, string> = {
  "s-document-control": "Pengendalian dokumen",
  "s-1": "Tujuan, prinsip dan ruang lingkup",
  "s-2": "Definisi",
  "s-3": "Kelayakan",
  "s-4": "Pengusulan dan persetujuan proyek",
  "s-5": "Klasifikasi proyek dan pendapatan bersih",
  "s-6": "Peran, bobot dan perhitungan bonus",
  "s-7": "Beban kerja, kapasitas dan kinerja",
  "s-8": "Siklus pembayaran bonus",
  "s-9": "Pengendalian keuangan",
  "s-10": "Perubahan status kepegawaian",
  "s-11": "Karyawan masa percobaan",
  "s-12": "Integritas, perilaku dan standar profesional",
  "s-13": "Tata kelola, tanggung jawab dan catatan",
  "s-14": "Sengketa dan banding",
  "s-15": "Transisi, implementasi dan peninjauan",
  "s-16": "Contoh perhitungan",
  "s-17": "Kontak, lampiran dan riwayat revisi",
  "s-annex-a": "Usulan proyek",
  "s-annex-b": "Perjanjian Keikutsertaan Proyek",
  "s-annex-c": "Pernyataan keikutsertaan karyawan masa percobaan",
  "s-annex-d": "Perjanjian Peran dan Bobot, formulir perubahan dan Buku Alokasi Tim",
  "s-annex-e": "Laporan bonus bulanan",
  "s-annex-f": "Pernyataan benturan kepentingan",
  "s-annex-g": "Laporan penutupan proyek",
};

/** "§5" → "Bagian 5", "Annex B" → "Lampiran B" */
export function labelId(label: string) {
  return label.replace(/^§/, "Bagian ").replace(/^Annex /, "Lampiran ");
}

export interface AgreementText {
  title: string;
  intro: string;
  fields: Record<string, string>;
  lead: string;
  terms: string[];
  signLabel: string;
}

/** Field keys shared by both languages (labels come from the language's text). */
export type AnnexBField = "name" | "number" | "position" | "manager" | "status" | "time";
export type AnnexCField = "name" | "start" | "probationEnd" | "firstProject";

export const ANNEX_B_ID: AgreementText = {
  title: "Lampiran B. Perjanjian Keikutsertaan Proyek",
  intro: "Ditandatangani satu kali oleh setiap karyawan sebelum proyek pertamanya berdasarkan kebijakan ini, dan ditandatangani kembali apabila kebijakan berubah secara material. Perjanjian ini merupakan adendum atas perjanjian kerja karyawan.",
  fields: {
    name: "Nama karyawan",
    number: "Nomor induk karyawan",
    position: "Jabatan dan departemen",
    manager: "Atasan langsung",
    status: "Status kepegawaian (tetap, PKWT, paruh waktu atau masa percobaan), dan tanggal berakhirnya kontrak bila PKWT",
    time: "Waktu proyek maksimum yang disepakati dengan atasan langsung (jam per bulan atau % dari waktu kerja)",
  },
  lead: "Dengan menandatangani, saya menyatakan telah membaca Kebijakan Inisiatif Proyek dan Kompensasi, Versi 4.0, dan saya memahami serta menerima bahwa:",
  terms: [
    "Bonus proyek adalah pembayaran variabel berbasis kinerja. Bonus proyek bukan bagian dari upah pokok atau tunjangan tetap saya dan tidak dijamin (Bagian 1.5).",
    "Bonus hanya dibayarkan atas pendapatan yang telah diterima perusahaan, bersama gaji berikutnya setelah penerimaan tersebut, dan hanya apabila perusahaan lulus uji titik impas dan pemeriksaan kas (Bagian 8 dan 9.1). Pengecualiannya adalah bonus minimum terjamin proyek Tipe C, yang dibayarkan meskipun belum ada pendapatan; tambahan (top-up) tersebut dipotong dari bonus saya berikutnya pada proyek itu (Bagian 8.6).",
    "Bagian saya bergantung pada peran, bobot dan faktor alokasi yang tercatat dalam Perjanjian Peran dan Bobot beserta perubahannya (Bagian 6.7 dan 6.8).",
    "Pada proyek berisiko tinggi, hingga 30% bonus saya dapat ditangguhkan selama 6 sampai 12 bulan setelah proyek ditutup (Bagian 9.3).",
    "Bonus dapat ditarik kembali dari saya dalam keadaan yang diatur dalam Bagian 9.4. Setiap pemotongan dari gaji saya memerlukan persetujuan tertulis saya secara terpisah dan tetap dalam batas yang diatur dalam bagian tersebut.",
    "Apabila saya mengundurkan diri, diberhentikan, atau status saya berubah, bonus yang belum dibayar akan dibayarkan atau hangus sebagaimana diatur dalam Bagian 10.",
    "Peran pokok saya didahulukan. Saya akan tetap berada dalam batas waktu proyek yang disepakati dengan atasan langsung saya (Bagian 7.1).",
    "Saya akan mematuhi ketentuan integritas, benturan kepentingan, kerahasiaan dan keselamatan dalam Bagian 12, dan saya akan memberitahukan setiap perubahan status kepegawaian saya dalam 2 hari kerja (Bagian 3.5).",
    "Klien, kontrak dan hasil kerja adalah milik perusahaan (Bagian 12.1).",
  ],
  signLabel: "Tanda tangan elektronik — ketik nama lengkap Anda sesuai catatan HR",
};

export const ANNEX_C_ID: AgreementText = {
  title: "Lampiran C. Pernyataan keikutsertaan karyawan masa percobaan",
  intro: "Ditandatangani oleh karyawan dalam masa percobaan sebelum bergabung dengan proyek pertamanya (Bagian 11.2), sebagai tambahan atas Lampiran B.",
  fields: {
    name: "Nama karyawan",
    start: "Tanggal mulai bekerja",
    probationEnd: "Tanggal berakhirnya masa percobaan",
    firstProject: "Kode proyek dan peran pertama",
  },
  lead: "Saya memahami dan menerima bahwa:",
  terms: [
    "Seluruh bonus yang saya peroleh selama masa percobaan dihitung seperti biasa tetapi ditahan, tidak dibayarkan, hingga masa percobaan saya berakhir (Bagian 11.3). Pengecualiannya adalah bagian saya atas pool proyek Tipe C pada bulan ketika top-up minimum dibayarkan, yang dibayarkan bersama gaji (Bagian 8.6). Setiap top-up dalam bagian tersebut akan dipotong dari bonus saya berikutnya pada proyek itu.",
    "Saya akan menerima laporan bulanan atas jumlah yang ditahan.",
    "Apabila saya lulus masa percobaan dan diangkat sebagai karyawan tetap, seluruh saldo akan dibayarkan sebagai Bonus Penyelesaian Masa Percobaan dalam 30 hari sejak tanggal berakhirnya masa percobaan saya, dikurangi pajak penghasilan.",
    "Apabila saya tidak lulus masa percobaan, atau hubungan kerja saya berakhir selama masa percobaan, saldo yang ditahan dibayarkan bersama pembayaran akhir saya, kecuali saya diberhentikan karena pelanggaran berat (Bagian 10 dan 11.4).",
  ],
  signLabel: "Tanda tangan elektronik",
};

/** English field labels of the two forms (the form tables in docs/policy/v4.0.md). */
export const ANNEX_B_FIELDS_EN: Record<AnnexBField, string> = {
  name: "Employee name",
  number: "Employee number",
  position: "Position and department",
  manager: "Line manager",
  status: "Employment status, and contract end date if fixed-term",
  time: "Maximum project time agreed with line manager",
};
export const ANNEX_C_FIELDS_EN: Record<AnnexCField, string> = {
  name: "Employee name",
  start: "Start date",
  probationEnd: "Probation end date",
  firstProject: "First project code and role",
};

/** UI strings of the signing dialog in both languages. */
export const SIGN_UI: Record<PolicyLang, { confirm: (name: string, annexC: boolean) => string; typeName: string; mismatch: string; sign: string; countersign: string; signedBy: string }> = {
  en: {
    confirm: (name, c) => `I, ${name}, confirm that I have read the Project Initiative and Compensation Policy, Version 4.0, and I understand and accept the terms above${c ? ", including Annex C" : ""}.`,
    typeName: "Type your full name as your electronic signature",
    mismatch: "The typed name must match your name in the HR record",
    sign: "Sign electronically",
    countersign: "The line manager and HR countersign through HR.",
    signedBy: "Signed electronically by",
  },
  id: {
    confirm: (name, c) => `Saya, ${name}, menyatakan telah membaca Kebijakan Inisiatif Proyek dan Kompensasi, Versi 4.0, dan saya memahami serta menerima ketentuan di atas${c ? ", termasuk Lampiran C" : ""}.`,
    typeName: "Ketik nama lengkap Anda sebagai tanda tangan elektronik",
    mismatch: "Nama yang diketik harus sama dengan nama Anda di catatan HR",
    sign: "Tanda tangani secara elektronik",
    countersign: "Atasan langsung dan HR menandatangani melalui HR.",
    signedBy: "Ditandatangani secara elektronik oleh",
  },
};
