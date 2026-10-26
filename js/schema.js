// Σταθερές της εφαρμογής. Όλα τα κείμενα και οι κατηγορίες προέρχονται από το «Πρωτόκολλο πεδίου».
export const APP_VERSION = '3.0.0';
export const APP_NAME = 'Αμμοθίνες';

// Ζώνες θίνας, από τη θάλασσα προς την ενδοχώρα (πρωτόκολλο, ενότητα 4).
export const ZONES = [
  { n: 0, short: 'Παραλία', long: 'Παραλία / γραμμή κύματος', color: '#BFE0F2' },
  { n: 1, short: 'Πρωτογενείς', long: 'Πρωτογενείς θίνες', color: '#F7D9BC' },
  { n: 2, short: 'Κινούμενες', long: 'Κινούμενες θίνες', color: '#FAEB9E' },
  { n: 3, short: 'Σταθεροποιημένες', long: 'Σταθεροποιημένες θίνες', color: '#CFE3D0' },
  { n: 4, short: 'Θαμνώνες', long: 'Οπισθοθινική ζώνη / θαμνώνες', color: '#A9D3A6' },
];

// Είδη σημείων που καταγράφονται. «start» και «end» ζουν μέσα στη διατομή, όχι στα σημεία.
// icon: εικονίδιο Font Awesome (κλάση), για οθόνες και χάρτη.
export const KINDS = {
  quadrat: { label: 'Τετράγωνο 1×1 μ.', short: 'Τετράγωνο', icon: 'fa-solid fa-vector-square', color: '#2F6B50' },
  pressure: { label: 'Ανθρώπινη πίεση', short: 'Πίεση', icon: 'fa-solid fa-shoe-prints', color: '#C0392B' },
  lilies: { label: 'Ομάδα κρινάκι', short: 'Κρινάκια', icon: 'fa-solid fa-spa', color: '#D4A017' },
  invasive: { label: 'Εισβλητικό φυτό', short: 'Εισβλητικό', icon: 'fa-solid fa-ban', color: '#7B3FA0' },
  unknown: { label: 'Άγνωστο φυτό', short: 'Άγνωστο', icon: 'fa-solid fa-circle-question', color: '#B8660B' },
  zone: { label: 'Αλλαγή ζώνης', short: 'Ζώνη', icon: 'fa-solid fa-water', color: '#1F6B91' },
  photo: { label: 'Φωτογραφία / σημείωση', short: 'Φωτό', icon: 'fa-solid fa-camera', color: '#5A5A5A' },
  stop: { label: 'Στάση στη γραμμή', short: 'Στάση', icon: 'fa-solid fa-flag', color: '#0E7C86' },
  start: { label: 'Αρχή διατομής (θάλασσα)', short: 'Αρχή', icon: 'fa-solid fa-water', color: '#1F6B91' },
  end: { label: 'Τέλος διατομής (ενδοχώρα)', short: 'Τέλος', icon: 'fa-solid fa-tree', color: '#1F6B91' },
};

// Τρόποι έρευνας. Η ομάδα διαλέγει έναν.
//  protocol: πλήρες πρωτόκολλο — διατομή από τη θάλασσα στη στεριά, τετράγωνα κάθε Χ μέτρα, όλες οι ζώνες.
//  plots: ελεύθερα πλαίσια — λίγα τετράγωνα 1×1 μ. όπου θέλει η ομάδα, το καθένα με δική του θέση και κάτοψη.
export const MODES = {
  protocol: { label: 'Πλήρες πρωτόκολλο', short: 'διατομή', icon: 'fa-solid fa-route' },
  plots: { label: 'Πλαίσια έρευνας', short: 'πλαίσια', icon: 'fa-solid fa-border-all' },
  // Μόνο στη lite: σύντομη διατομή με στάσεις και ένα quadrat στη θίνη.
  focus: { label: 'Εστίαση στο quadrat', short: 'εστίαση', icon: 'fa-solid fa-crosshairs' },
};

// Σειρά κουμπιών στην οθόνη «Καταγραφή».
export const NEW_KINDS = {
  protocol: ['quadrat', 'pressure', 'lilies', 'invasive', 'unknown', 'zone', 'photo'],
  plots: ['quadrat', 'pressure', 'lilies', 'invasive', 'unknown', 'photo'],
  focus: ['quadrat', 'pressure', 'lilies', 'invasive', 'unknown', 'zone', 'photo'],
};

// Στάσεις της lite: πόσα φυτά βλέπουμε.
export const LEVELS = [
  { id: 'few', label: 'λίγα' },
  { id: 'some', label: 'αρκετά' },
  { id: 'many', label: 'πολλά' },
];

// Πιέσεις (πρωτόκολλο, Βήμα Ε και Φύλλο 3).
export const PRESSURES = [
  { id: 'umbrellas', label: 'Ομπρέλες / ξαπλώστρες / καντίνες πάνω στη θίνη', short: 'ομπρέλες' },
  { id: 'paths', label: 'Μονοπάτια που κόβουν τη θίνη', short: 'μονοπάτια' },
  { id: 'widepaths', label: 'Διαπλατυσμένα μονοπάτια', short: 'πλατιά_μονοπάτια' },
  { id: 'vehicle', label: 'Ρόδες οχήματος / μηχανής', short: 'ρόδες' },
  { id: 'litter', label: 'Σκουπίδια (πλαστικά, αποτσίγαρα)', short: 'σκουπίδια' },
  { id: 'broken', label: 'Σπασμένη / διαβρωμένη θίνη («γυμνές πληγές»)', short: 'διάβρωση' },
  { id: 'dogs', label: 'Σκύλοι ελεύθεροι', short: 'σκύλοι' },
  { id: 'cut', label: 'Φυτά με κοπή ή ξεριζωμένα', short: 'κομμένα_φυτά' },
  { id: 'other', label: 'Άλλο', short: 'άλλο' },
];

// Θέμα φωτογραφίας (Βήμα Α.4: πανοραμικές).
export const PHOTO_SUBJECTS = [
  { id: 'inland', label: 'Πανοραμική προς την ενδοχώρα', short: 'πανοραμική_ενδοχώρα' },
  { id: 'sea', label: 'Πανοραμική προς τη θάλασσα', short: 'πανοραμική_θάλασσα' },
  { id: 'other', label: 'Άλλη φωτογραφία / σημείωση', short: 'φωτογραφία' },
];

// Φυτά-κλειδιά (πρωτόκολλο, ενότητα 5). Λατινικά ονόματα: όσα δίνει το πρωτόκολλο και όσα έχει ο οδηγός φυτών (js/guide.js).
export const SPECIES = [
  { id: 'krinaki', name: 'Κρινάκι της θάλασσας', latin: 'Pancratium maritimum' },
  { id: 'galanagatho', name: 'Γαλανάγκαθο', latin: 'Eryngium maritimum' },
  { id: 'galatsida', name: 'Γαλατσίδα της παραλίας', latin: 'Euphorbia paralias' },
  { id: 'kalystegia', name: 'Καλυστέγια / περικοκλάδα', latin: 'Calystegia soldanella' },
  { id: 'kakili', name: 'Κακίλη / ρόκα θάλασσας', latin: 'Cakile maritima' },
  { id: 'midiki', name: 'Μηδική της άμμου', latin: 'Medicago marina' },
  { id: 'mathiola', name: 'Μαθιόλα της άμμου', latin: 'Matthiola tricuspidata' },
  { id: 'otanthos', name: 'Ώτανθος / βαμβακιά', latin: 'Otanthus maritimus' },
  { id: 'thalassokedro', name: 'Θαλασσόκεδρο', latin: 'Juniperus macrocarpa' },
  { id: 'schinos', name: 'Σχίνος', latin: '' },
  { id: 'kentavria', name: 'Κενταύρια η αγκαθωτή', latin: 'Centaurea spinosa' },
  { id: 'agrostodi', name: 'Αγρωστώδη', latin: '' },
  { id: 'phrygana', name: 'Φρύγανα', latin: '' },
  { id: 'carpobrotus', name: 'Χουζούρι (αγιόκλημα της παραλίας)', latin: 'Carpobrotus edulis', invasive: true },
];

// Κριτήρια υγείας (πρωτόκολλο, ενότητα 7 και Φύλλο 4). Κάθε επιλογή: 0, 1 ή 2 βαθμοί.
export const CRITERIA = [
  { id: 'cover', name: 'Φυτοκάλυψη στις ζώνες 2–3', opts: ['Σχεδόν γυμνή άμμος', 'Αραιά φυτά', 'Καλή κάλυψη, ποικιλία φυτών'] },
  { id: 'lilies', name: 'Παρουσία κρινάκι', opts: ['Κανένα', 'Λίγα άτομα', 'Αρκετά / ομάδες'] },
  { id: 'zonation', name: 'Ζώνωση (φαίνονται οι ζώνες;)', opts: ['Όχι, όλα ανακατεμένα / κατεστραμμένα', 'Φαίνονται 1–2 ζώνες', 'Καθαρή σειρά ζωνών'] },
  { id: 'invasive', name: 'Εισβλητικά φυτά (αντίστροφα)', opts: ['Μεγάλης έκτασης «χαλί»', 'Λίγες τούφες', 'Απουσιάζουν'] },
  { id: 'pressure', name: 'Ανθρώπινη πίεση (αντίστροφα)', opts: ['Ομπρέλες πάνω στη θίνη, ρόδες, πολλά μονοπάτια', 'Κάποια μονοπάτια / λίγα σκουπίδια', 'Ελάχιστα ίχνη, μονοπάτια στην άκρη'] },
];

export const HEALTH_BANDS = [
  { max: 3, label: 'Κακή κατάσταση: χρειάζεται προστασία', color: '#C0392B' },
  { max: 7, label: 'Μέτρια κατάσταση: υπάρχουν προβλήματα αλλά και ζωντανά κομμάτια', color: '#B8860B' },
  { max: 10, label: 'Καλή κατάσταση: πρότυπο για σύγκριση με άλλες παραλίες', color: '#2F6B50' },
];

export const WEATHER_CHIPS = [
  { label: 'ήλιος', icon: 'fa-solid fa-sun' },
  { label: 'λίγα σύννεφα', icon: 'fa-solid fa-cloud-sun' },
  { label: 'συννεφιά', icon: 'fa-solid fa-cloud' },
  { label: 'άνεμος', icon: 'fa-solid fa-wind' },
  { label: 'ζέστη', icon: 'fa-solid fa-temperature-high' },
];

// Ετικέτες πηγής θέσης.
export const SRC_LABEL = {
  gps: 'GPS', map: 'από χάρτη', manual: 'με αριθμούς', calc: 'υπολογισμένη', none: 'χωρίς θέση',
};

// Στήλες εξαγωγής σημείων. Το «key» είναι το όνομα στο GeoJSON, το «label» η κεφαλίδα στο CSV.
// Ο φύλακας tools/check_columns.mjs ελέγχει ότι ο κώδικας εξαγωγής δίνει τιμή σε ΚΑΘΕ στήλη.
export const POINT_COLUMNS = [
  { key: 'id', label: 'id' },
  { key: 'team', label: 'Ομάδα' },
  { key: 'school', label: 'Σχολείο' },
  { key: 'beach', label: 'Παραλία' },
  { key: 'date', label: 'Ημερομηνία' },
  { key: 'time', label: 'Ώρα' },
  { key: 'kind', label: 'Είδος' },
  { key: 'name', label: 'Όνομα' },
  { key: 'dist_m', label: 'Απόσταση από θάλασσα (μ.)' },
  { key: 'zone', label: 'Ζώνη (0–4)' },
  { key: 'bare_pct', label: '% γυμνή άμμος' },
  { key: 'litter_pct', label: '% νεκρά φύλλα / ξύλα / φύκια' },
  { key: 'plants_pct', label: '% φυτά σύνολο' },
  { key: 'invasive_pct', label: '% εισβλητικά' },
  { key: 'species_count', label: 'Αριθμός ειδών' },
  { key: 'lilies', label: 'Κρινάκια (άτομα)' },
  { key: 'species', label: 'Είδη' },
  { key: 'footprint', label: 'Αποτύπωμα / μονοπάτι μέσα στο τετράγωνο' },
  { key: 'pressure_type', label: 'Είδος πίεσης' },
  { key: 'plot', label: 'Πλαίσιο αρ.' },
  { key: 'pins', label: 'Πινέζες φυτών (κάτοψη)' },
  { key: 'level', label: 'Φυτά (λίγα / αρκετά / πολλά)' },
  { key: 'observe', label: 'Τι βλέπω / γιατί το ξεχώρισα' },
  { key: 'comment', label: 'Σχόλιο' },
  { key: 'lat', label: 'Γεωγραφικό πλάτος' },
  { key: 'lon', label: 'Γεωγραφικό μήκος' },
  { key: 'pos_source', label: 'Πηγή θέσης' },
  { key: 'accuracy_m', label: 'Ακρίβεια GPS (μ.)' },
  { key: 'photos', label: 'Φωτογραφίες (αρχεία)' },
];

export const TRANSECT_COLUMNS = [
  { key: 'id', label: 'id' },
  { key: 'school', label: 'Σχολείο' },
  { key: 'team', label: 'Ομάδα' },
  { key: 'members', label: 'Μέλη' },
  { key: 'beach', label: 'Παραλία' },
  { key: 'area', label: 'Περιοχή έρευνας (κωδικός)' },
  { key: 'mode', label: 'Τρόπος έρευνας' },
  { key: 'date', label: 'Ημερομηνία' },
  { key: 'time', label: 'Ώρα' },
  { key: 'weather', label: 'Καιρός' },
  { key: 'length_m', label: 'Μήκος διατομής (μ.)' },
  { key: 'spacing_m', label: 'Απόσταση τετραγώνων (μ.)' },
  { key: 'start_lat', label: 'Αρχή: πλάτος' },
  { key: 'start_lon', label: 'Αρχή: μήκος' },
  { key: 'start_source', label: 'Αρχή: πηγή' },
  { key: 'end_lat', label: 'Τέλος: πλάτος' },
  { key: 'end_lon', label: 'Τέλος: μήκος' },
  { key: 'end_source', label: 'Τέλος: πηγή' },
  { key: 'n_quadrats', label: 'Τετράγωνα / πλαίσια' },
  { key: 'n_photos', label: 'Φωτογραφίες' },
  { key: 'score_cover', label: 'Βαθμοί: φυτοκάλυψη' },
  { key: 'why_cover', label: 'Γιατί: φυτοκάλυψη' },
  { key: 'score_lilies', label: 'Βαθμοί: κρινάκι' },
  { key: 'why_lilies', label: 'Γιατί: κρινάκι' },
  { key: 'score_zonation', label: 'Βαθμοί: ζώνωση' },
  { key: 'why_zonation', label: 'Γιατί: ζώνωση' },
  { key: 'score_invasive', label: 'Βαθμοί: εισβλητικά' },
  { key: 'why_invasive', label: 'Γιατί: εισβλητικά' },
  { key: 'score_pressure', label: 'Βαθμοί: ανθρώπινη πίεση' },
  { key: 'why_pressure', label: 'Γιατί: ανθρώπινη πίεση' },
  { key: 'score_total', label: 'Σύνολο / 10' },
  { key: 'health_label', label: 'Κατάσταση' },
  { key: 'impression_1', label: 'Εντύπωση 1' },
  { key: 'impression_2', label: 'Εντύπωση 2' },
  { key: 'impression_3', label: 'Εντύπωση 3' },
  { key: 'proposal', label: 'Πρόταση προστασίας' },
  { key: 'notes', label: 'Σημειώσεις' },
];
