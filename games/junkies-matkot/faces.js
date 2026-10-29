// The 11 heads (spec §3), carousel order. Images and eyes-closed frames are copies under
// assets/faces/ (G20) -- never a live path into games/junkies-pro or design/game10-board-assets.
// Lines come only from that person's own lines_he; a head with one line repeats it on the win too.
export const HEADS = [
  { id: "dagi", name: "דגי", image: "assets/faces/dagi.webp", eyesClosed: "assets/faces/dagi-eyes-closed.webp", lines: ["רונזו, תעזוב ת׳טלפון", "זה מה שהיא אמרה"] },
  { id: "eitan", name: "איתן", image: "assets/faces/eitan.webp", eyesClosed: "assets/faces/eitan-eyes-closed.webp", lines: ["נייס!", "תעביר את הגרעינים"] },
  { id: "saalem", name: "סאעלם", image: "assets/faces/saalem.webp", eyesClosed: null, lines: ["זה לא יקרה!", "איזה מטופם!"] },
  { id: "shaiko", name: "שייקו", image: "assets/faces/shaiko.webp", eyesClosed: "assets/faces/shaiko-eyes-closed.webp", lines: ["חד משמעית", "מי רוצה במבה?"] },
  { id: "yontsi", name: "יונצי", image: "assets/faces/yontsi.webp", eyesClosed: "assets/faces/yontsi-eyes-closed.webp", lines: ["אני פשוט שחקן מעולה!", "חלב ועוגיות מישהו?"] },
  { id: "nir", name: "ניר", image: "assets/faces/nir.webp", eyesClosed: "assets/faces/nir-eyes-closed.webp", lines: ["יצא צבע ניר", "סורי"] },
  { id: "ronzo", name: "רונזו", image: "assets/faces/ronzo.webp", eyesClosed: "assets/faces/ronzo-eyes-closed.webp", lines: ["אחד גבוה אחד נמוך סוטד", "הבאתי עוגיות"] },
  { id: "even", name: "אבן", image: "assets/faces/even.webp", eyesClosed: "assets/faces/even-eyes-closed.webp", lines: ["קונהצ!", "מישהו רוצה מרק וואנטון?"] },
  { id: "daniel", name: "דניאל", image: "assets/faces/daniel.webp", eyesClosed: null, lines: ["אול אין!"] },
  { id: "miki", name: "מיקי", image: "assets/faces/miki.webp", eyesClosed: null, lines: ["אווו פמלה.."] },
  { id: "koko", name: "קוקו", image: "assets/faces/koko.webp", eyesClosed: null, lines: ["קוקו הגיע!"] },
];

export function headById(id) { return HEADS.find((h) => h.id === id) || null; }

// A head's line 2 (the win line); a one-line head repeats line 1.
export function lineOf(head, index) { return head.lines[index] ?? head.lines[0]; }
