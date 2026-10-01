import {
  Activity, Amphora, Anchor, Atom, AudioWaveform, Bike, Bird, BookHeadphones, BookImage, BookOpen, Bot, Box,
  Brain, BrainCircuit, CakeSlice, Camera, Car, Caravan, Cat, ChefHat, Clapperboard, Code, Coffee, Coins, Compass,
  Cpu, Crown, Dices, Dog, Drama, Drum, Dumbbell, Feather, Film, Fish, Flower, Flower2, Footprints, Gamepad2, Gem,
  GraduationCap, Guitar, Hammer, HandHeart, HandHelping, Handshake, Headphones, Joystick, Landmark, Languages, Leaf,
  Lightbulb, ListChecks, Map as MapIcon, MicVocal, Microchip, Monitor, Mountain, MountainSnow, Music, Music2, Music3, Newspaper,
  NotebookPen, Origami, Palette, PartyPopper, PawPrint, PenLine, PenTool, Pencil, PersonStanding, Piano, PiggyBank,
  Plane, Podcast, Puzzle, Ribbon, Rocket, Route, Sailboat, Salad, Scissors, Scroll, Shield, ShieldCheck, Shirt, Shovel,
  Signature, Smartphone, Snowflake, Sofa, Sparkles, Speech, Sprout, Stamp, Sunrise, Swords, Target, Telescope, Tent,
  Ticket, ToyBrick, Trees, Trophy, Tv, TvMinimalPlay, Users, Utensils, Video, Volleyball, WandSparkles, Waves, Wheat,
  Wind,
} from "lucide-react";

// Hobby catalog for the Hobilerim panel: categories, ~90 suggestions and the
// keyword rules that give a typed-in hobby a fitting icon. Colours are
// "r,g,b" strings (Tailwind 300 tones) so tiles can mix their own alphas.

export const DEFAULT_RGB = "240,171,252"; // fuchsia — the panel accent

export const CATEGORIES = [
  { key: "sport", tr: "Spor ve hareket", en: "Sports and movement", shortTr: "Spor", shortEn: "Sports", icon: Dumbbell, rgb: "110,231,183" },
  { key: "art", tr: "Sanat ve üretim", en: "Arts and making", shortTr: "Sanat", shortEn: "Arts", icon: Palette, rgb: "253,164,175" },
  { key: "music", tr: "Müzik", en: "Music", shortTr: "Müzik", shortEn: "Music", icon: Music, rgb: "240,171,252" },
  { key: "tech", tr: "Teknoloji", en: "Technology", shortTr: "Teknoloji", shortEn: "Tech", icon: Cpu, rgb: "125,211,252" },
  { key: "games", tr: "Oyun ve eğlence", en: "Games and fun", shortTr: "Eğlence", shortEn: "Fun", icon: Gamepad2, rgb: "165,180,252" },
  { key: "nature", tr: "Doğa ve seyahat", en: "Nature and travel", shortTr: "Doğa", shortEn: "Outdoors", icon: Compass, rgb: "94,234,212" },
  { key: "culture", tr: "Kültür ve öğrenme", en: "Culture and learning", shortTr: "Kültür", shortEn: "Culture", icon: BookOpen, rgb: "252,211,77" },
  { key: "home", tr: "Mutfak ve yaşam", en: "Food and home", shortTr: "Mutfak", shortEn: "Food", icon: ChefHat, rgb: "253,186,116" },
  { key: "growth", tr: "Kişisel gelişim", en: "Personal growth", shortTr: "Gelişim", shortEn: "Growth", icon: Sprout, rgb: "190,242,100" },
  { key: "social", tr: "Sosyal", en: "Social", shortTr: "Sosyal", shortEn: "Social", icon: Users, rgb: "196,181,253" },
];

export const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

// Lowercase (Turkish rules), strip accents and fold ı to i, so "MÜZİK",
// "müzik" and "muzik" compare equal; punctuation runs become one space.
export const MARKS = /[̀-ͯ]/g;
export function fold(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(MARKS, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const item = (category, icon, tr, en) => ({
  id: `${category}-${fold(en).replace(/ /g, "-")}`,
  category, icon, tr, en, keys: [fold(tr), fold(en)],
});

export const CATALOG = [
  item("sport", Dumbbell, "Fitness", "Fitness"),
  item("sport", Footprints, "Koşu", "Running"),
  item("sport", Route, "Yürüyüş", "Walking"),
  item("sport", Volleyball, "Futbol", "Football"),
  item("sport", Flower2, "Yoga", "Yoga"),
  item("sport", Bike, "Bisiklet", "Cycling"),
  item("sport", Waves, "Yüzme", "Swimming"),
  item("sport", Volleyball, "Basketbol", "Basketball"),
  item("sport", PersonStanding, "Dans", "Dancing"),
  item("sport", Snowflake, "Kayak", "Skiing"),
  item("sport", Shield, "Dövüş sanatları", "Martial arts"),

  item("art", Palette, "Resim", "Painting"),
  item("art", Pencil, "Çizim", "Drawing"),
  item("art", Camera, "Fotoğrafçılık", "Photography"),
  item("art", PenLine, "Yazı yazmak", "Writing"),
  item("art", Signature, "Kaligrafi", "Calligraphy"),
  item("art", Scissors, "El sanatları", "Crafts"),
  item("art", Ribbon, "Örgü ve dikiş", "Knitting and sewing"),
  item("art", Amphora, "Seramik", "Pottery"),
  item("art", Hammer, "Ahşap işleri", "Woodworking"),
  item("art", PenTool, "Grafik tasarım", "Graphic design"),

  item("music", Headphones, "Müzik dinlemek", "Listening to music"),
  item("music", Guitar, "Gitar", "Guitar"),
  item("music", Piano, "Piyano", "Piano"),
  item("music", MicVocal, "Şarkı söylemek", "Singing"),
  item("music", Drum, "Davul", "Drums"),
  item("music", Music3, "Bağlama", "Bağlama"),
  item("music", Music2, "Keman", "Violin"),
  item("music", AudioWaveform, "Beste yapmak", "Composing"),
  item("music", Ticket, "Konserler", "Concerts"),

  item("tech", Code, "Yazılım", "Programming"),
  item("tech", BrainCircuit, "Yapay zekâ", "AI"),
  item("tech", Bot, "Robotik", "Robotics"),
  item("tech", Microchip, "Elektronik", "Electronics"),
  item("tech", Box, "3D baskı", "3D printing"),
  item("tech", Monitor, "Web tasarımı", "Web design"),
  item("tech", ShieldCheck, "Siber güvenlik", "Cyber security"),
  item("tech", Video, "Video içerik üretmek", "Making videos"),
  item("tech", Car, "Otomobiller", "Cars"),

  item("games", Gamepad2, "Video oyunları", "Video games"),
  item("games", Crown, "Satranç", "Chess"),
  item("games", Dices, "Masa oyunları", "Board games"),
  item("games", Puzzle, "Bulmaca", "Puzzles"),
  item("games", ToyBrick, "Lego ve maket", "LEGO and models"),
  item("games", Clapperboard, "Film izlemek", "Watching films"),
  item("games", Tv, "Dizi izlemek", "TV series"),
  item("games", TvMinimalPlay, "Anime", "Anime"),
  item("games", BookImage, "Çizgi roman", "Comics"),
  item("games", Trophy, "Maç izlemek", "Watching sports"),

  item("nature", Plane, "Seyahat", "Travel"),
  item("nature", Mountain, "Doğa yürüyüşü", "Hiking"),
  item("nature", Tent, "Kamp", "Camping"),
  item("nature", MountainSnow, "Dağcılık", "Mountain climbing"),
  item("nature", Caravan, "Karavan gezisi", "Caravan trips"),
  item("nature", MapIcon, "Şehir keşfi", "Exploring cities"),
  item("nature", Shovel, "Bahçecilik", "Gardening"),
  item("nature", Fish, "Balık tutmak", "Fishing"),
  item("nature", Bird, "Kuş gözlemi", "Bird watching"),
  item("nature", Sailboat, "Yelken", "Sailing"),

  item("culture", BookOpen, "Kitap okumak", "Reading"),
  item("culture", Feather, "Şiir", "Poetry"),
  item("culture", Scroll, "Tarih", "History"),
  item("culture", Lightbulb, "Felsefe", "Philosophy"),
  item("culture", Brain, "Psikoloji", "Psychology"),
  item("culture", Languages, "Yabancı dil öğrenmek", "Learning languages"),
  item("culture", Telescope, "Astronomi", "Astronomy"),
  item("culture", Landmark, "Müze gezmek", "Museums"),
  item("culture", Drama, "Tiyatro", "Theatre"),
  item("culture", Podcast, "Podcast dinlemek", "Podcasts"),
  item("culture", Film, "Belgesel izlemek", "Documentary films"),

  item("home", ChefHat, "Yemek yapmak", "Cooking"),
  item("home", CakeSlice, "Pasta ve tatlı", "Baking"),
  item("home", Coffee, "Kahve", "Coffee"),
  item("home", Utensils, "Yeni lezzetler denemek", "Trying new food"),
  item("home", Salad, "Sağlıklı beslenme", "Healthy eating"),
  item("home", Leaf, "Ev bitkileri", "Houseplants"),
  item("home", PawPrint, "Evcil hayvanlar", "Pets"),
  item("home", Sofa, "Dekorasyon", "Interior design"),
  item("home", Shirt, "Moda", "Fashion"),

  item("growth", Flower, "Meditasyon", "Meditation"),
  item("growth", Wind, "Nefes egzersizleri", "Breathwork"),
  item("growth", NotebookPen, "Günlük tutmak", "Journaling"),
  item("growth", Sunrise, "Sabah rutini", "Morning routines"),
  item("growth", ListChecks, "Verimlilik", "Productivity"),
  item("growth", Rocket, "Girişimcilik", "Startups"),
  item("growth", GraduationCap, "Online kurslar", "Online courses"),

  item("social", HandHeart, "Gönüllülük", "Volunteering"),
  item("social", Users, "Arkadaşlarla buluşmak", "Meeting friends"),
  item("social", Handshake, "Yeni insanlarla tanışmak", "Meeting new people"),
  item("social", PartyPopper, "Etkinlik düzenlemek", "Hosting events"),
  item("social", Speech, "Münazara", "Debating"),
  item("social", HandHelping, "Mentorluk", "Mentoring"),
];

export const CATALOG_BY_CATEGORY = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, CATALOG.filter((i) => i.category === c.key)])
);

const ITEM_BY_KEY = new Map();
for (const entry of CATALOG) for (const key of entry.keys) if (!ITEM_BY_KEY.has(key)) ITEM_BY_KEY.set(key, entry);

// Keyword rules for hobbies typed in by hand. Keywords are already folded and
// match at the start of a word ("gitar" matches "gitar çalmak"); a trailing
// space means whole word only, for short or ambiguous stems ("dag " must not
// catch "dagitim"). The longest matching keyword wins, so "doga yuruyusu"
// beats "yuruyus" and "e spor" beats "spor" regardless of rule order. A "~"
// marks a generic word ("ogrenmek", "okumak") that only decides when nothing
// more specific matches, so "Gitar öğrenmek" keeps the guitar.
const rule = (icon, category, keywords) => ({
  icon,
  category,
  keys: keywords.split("|").map((k) => (k.startsWith("~") ? { text: k.slice(1), weight: 0.5 } : { text: k, weight: k.length })),
});

const RULES = [
  // Sports and movement
  rule(Volleyball, "sport", "futbol|basketbol|voleybol|hentbol|tenis|masa tenisi|badminton|golf|beyzbol|ragbi|futsal|squash|padel|football|soccer|basketball|volleyball|handball|tennis|table tennis|baseball|rugby"),
  rule(Dumbbell, "sport", "fitness|spor salonu|gym|agirlik|vucut gelistirme|crossfit|kalistenik|calisthenics|weightlifting|bodybuilding|antrenman|workout|spor |sporlar|sport |sports"),
  rule(Footprints, "sport", "kosu|kosmak|jogging|running|run |maraton|marathon|triatlon|triathlon"),
  rule(Route, "sport", "yuruyus|yurumek|walking|walk "),
  rule(Flower2, "sport", "yoga"),
  rule(Activity, "sport", "pilates|esneme|stretching|aerobik|aerobics|zumba"),
  rule(Bike, "sport", "bisiklet|cycling|bike|biking|bmx|dag bisiklet"),
  rule(Waves, "sport", "yuzme|yuzmek|swim|sorf|surf|su sporlari|water sports"),
  rule(Snowflake, "sport", "kayak|ski|skiing|snowboard|kizak|buz pateni|ice skating"),
  rule(Target, "sport", "okculuk|archery|dart|darts"),
  rule(Shield, "sport", "boks|boxing|kickboks|kickboxing|karate|judo|tekvando|taekwondo|aikido|dovus|dovus sanat|martial|muay thai|kung fu|jiu jitsu|wushu|mma |savunma sanat|self defense"),
  rule(Swords, "sport", "eskrim|fencing"),
  rule(PersonStanding, "sport", "dans|dance|dancing|bale|ballet|salsa|tango|bachata|halk oyun|folk dance|hip hop|breakdans"),
  rule(Trophy, "games", "mac izle|maclar|mac |taraftar|spor izle|watching sports|sports fan|formula|f1 "),

  // Arts and making
  rule(Palette, "art", "resim|painting|boya|tuval|canvas|sulu boya|watercolor|yagli boya|akrilik|acrylic|sanat|art |arts|artwork"),
  rule(Pencil, "art", "cizim|cizmek|drawing|draw |eskiz|sketch|karakalem|illustrasyon|illustration|karikatur|cartoon"),
  rule(Camera, "art", "foto|fotograf|fotografcilik|photo|photography|kamera|camera"),
  rule(PenLine, "art", "yazi yaz|~yazmak|yazar|yazarlik|writing|writer|hikaye|oyku|roman yaz|senaryo|screenwriting|blog|story|stories"),
  rule(Signature, "art", "kaligrafi|calligraphy|hat sanati|hattat|lettering"),
  rule(Scissors, "art", "el sanat|el isi|elisi|craft|crafts|diy|kendin yap|scrapbook|kolaj|collage|boncuk|taki|jewelry|makrome|macrame|kece|sabun yap|mum yap|candle"),
  rule(Ribbon, "art", "orgu|ormek|knit|crochet|tig isi|dikis|nakis|sewing|embroidery|goblen|quilt|patchwork"),
  rule(Amphora, "art", "seramik|comlek|pottery|ceramic|heykel|sculpt|kil |clay|cini"),
  rule(Hammer, "art", "ahsap|marangoz|woodwork|oymacilik|tamir|tamirat|maker|restorasyon"),
  rule(Origami, "art", "origami|kagit isi|paper craft"),
  rule(PenTool, "art", "grafik|graphic|tasarim|design|logo|ui |ux |figma|photoshop|illustrator|tipografi|typography|animasyon|animation"),

  // Music
  rule(Music, "music", "muzik|music|sarki|song|songs|album|rap |rock|jazz|caz |pop "),
  rule(Headphones, "music", "muzik dinle|listening to music|music listening|kulaklik|headphones|spotify|playlist|calma listesi"),
  rule(Guitar, "music", "gitar|guitar|ukulele|bas gitar|bass guitar|elektro gitar"),
  rule(Music3, "music", "baglama|saz |ud |oud|kanun|ney |kemence|turk muzig|halk muzig|turku|tambur"),
  rule(Music2, "music", "keman|violin|viyola|viola|viyolonsel|cello|kontrbas|flut|flute|klarnet|clarinet|saksafon|saxophone|sax |trompet|trumpet|arp |harp|orkestra|orchestra|klasik muzik|classical music"),
  rule(Piano, "music", "piyano|piano|klavye|keyboard|org |synth|sentezleyici"),
  rule(Drum, "music", "davul|drum|drums|bateri|perkusyon|percussion|darbuka|def "),
  rule(MicVocal, "music", "sarki soyle|singing|sing |vokal|vocal|koro|choir|karaoke"),
  rule(AudioWaveform, "music", "beste|composing|compose|dj |produksiyon|music production|beat|beatbox|mix |mixing|ableton|fl studio|logic pro|muzik yap|making music"),
  rule(Ticket, "music", "konser|concert|concerts|festival|canli muzik|live music|gig "),

  // Technology
  rule(Code, "tech", "kod|kod yaz|kodlama|yazilim|programlama|programming|coding|code|developer|gelistirici|python|javascript|java |react|software|oyun gelistir|game dev|uygulama gelistir|web gelistir|web development|frontend|backend|algoritma|algorithm"),
  rule(BrainCircuit, "tech", "yapay zeka|ai |artificial intelligence|makine ogrenme|machine learning|derin ogrenme|deep learning|chatgpt|llm|veri bilim|data science"),
  rule(Bot, "tech", "robot|robotik|robotics|arduino|raspberry|otomasyon|automation"),
  rule(Microchip, "tech", "elektronik|electronics|devre|circuit|lehim|soldering|donanim|hardware"),
  rule(Box, "tech", "3d|3 boyutlu|modelleme|modeling|blender|cad "),
  rule(Monitor, "tech", "web tasarim|web design|web sitesi|website"),
  rule(ShieldCheck, "tech", "siber|cyber|guvenlik|security|hacking|ctf "),
  rule(Cpu, "tech", "teknoloji|technology|tech |bilgisayar|computer|pc "),
  rule(Smartphone, "tech", "gadget|gadgets|telefon|phone|akilli saat|smartwatch|teknolojik cihaz|sosyal medya|social media|instagram"),
  rule(Video, "tech", "video|vlog|youtube|montaj|video kurgu|video editing|film cek|kisa film|short film|icerik uret|content creat|tiktok|yayin|streaming|twitch"),
  rule(Car, "tech", "araba|arabalar|otomobil|car |cars|otomotiv|automotive|motor |motosiklet|motorsiklet|motorcycle|modifiye|surus|driving"),
  rule(Plane, "tech", "drone|dron |havacilik|aviation|model ucak"),

  // Games and fun
  rule(Gamepad2, "games", "oyun|game|games|gaming|gamer|video oyun|bilgisayar oyun|pc oyun|mobil oyun|konsol|console|playstation|ps5|xbox|nintendo|minecraft|valorant|steam"),
  rule(Joystick, "games", "e spor|espor|esports|e sports|retro oyun|arcade|atari"),
  rule(Crown, "games", "satranc|chess|go oyunu|dama|checkers|strateji oyun|strategy game"),
  rule(Dices, "games", "masa oyun|kutu oyun|board game|tabletop|dnd|dungeons|kart oyun|card game|catan|tavla|backgammon|okey|rol yapma"),
  rule(Puzzle, "games", "bulmaca|puzzle|puzzles|sudoku|yapboz|zeka oyun|rubik|kelime oyun|crossword|escape room|kacis oda"),
  rule(ToyBrick, "games", "lego|maket|model kit|diorama|minyatur|miniature|warhammer|oyuncak|toy |toys"),
  rule(Clapperboard, "games", "film|filmler|sinema|cinema|movie|movies"),
  rule(Tv, "games", "dizi|diziler|series|tv |televizyon|netflix|show "),
  rule(TvMinimalPlay, "games", "anime"),
  rule(BookImage, "games", "cizgi roman|manga|comic|comics|webtoon|manhwa"),
  rule(WandSparkles, "games", "sihirbaz|sihirbazlik|magic|illuzyon|illusion"),

  // Nature and travel
  rule(Plane, "nature", "seyahat|gezi|gezmek|travel|traveling|travelling|tatil|vacation|yurt disi|backpacking|sirt cantali"),
  rule(MapIcon, "nature", "sehir kesf|sehir gez|sehir turu|city|cities|sehirler|harita|map "),
  rule(Compass, "nature", "kesif|kesfet|explore|exploring|macera|adventure|yeni yerler|oryantiring"),
  rule(Mountain, "nature", "doga yuruyus|dag yuruyus|trekking|hiking|hike|dag |daglar|tirmanis|climbing|kaya tirmanis|bouldering|patika|trail"),
  rule(MountainSnow, "nature", "dagcilik|mountaineering|alpinizm|zirve|summit|mountain climb"),
  rule(Tent, "nature", "kamp|camping|camp |cadir|piknik|picnic|bushcraft|glamping|outdoor"),
  rule(Caravan, "nature", "karavan|caravan|van life|vanlife|road trip|yolculuk|otostop|hitchhik"),
  rule(Shovel, "nature", "bahce|garden|gardening|bostan|sebze yetistir|fide|toprak|permakultur|tarim"),
  rule(Trees, "nature", "doga|nature|orman|forest|agac|tree|trees|kir |ekoloji|ecology"),
  rule(Fish, "nature", "balik|fishing|olta|fish |akvaryum|aquarium"),
  rule(Bird, "nature", "kus |kuslar|kus gozlem|kus besle|bird |birds|birdwatching|bird watching|ornitoloji"),
  rule(Sailboat, "nature", "yelken|sailing|tekne|boat|boating|kurek|rowing|kano|canoe|kayaking|rafting|sup "),
  rule(Anchor, "nature", "dalis|diving|scuba|snorkel|tuplu|freediving|denizcilik"),

  // Culture and learning
  rule(BookOpen, "culture", "kitap|kitaplar|~okuma|~okumak|~reading|~read |book|books|roman|edebiyat|literature|novel|novels|kutuphane|library|book club"),
  rule(BookHeadphones, "culture", "sesli kitap|audiobook|audiobooks"),
  rule(Feather, "culture", "siir|poetry|poem|poems|sair"),
  rule(Scroll, "culture", "tarih|history|arkeoloji|archaeology|osmanli|antik|ancient|mitoloji|mythology|soy agaci|genealogy"),
  rule(Landmark, "culture", "muze|museum|museums|sergi|exhibition|galeri|gallery|sanat tarih|art history|mimari|architecture"),
  rule(Lightbulb, "culture", "felsefe|philosophy|dusunce|mantik|logic"),
  rule(Brain, "culture", "psikoloji|psychology|sosyoloji|sociology|norobilim|neuroscience|zihin"),
  rule(Languages, "culture", "dil |diller|dil ogren|yabanci dil|language|languages|ingilizce|english|almanca|german|ispanyolca|spanish|fransizca|french|italyanca|italian|japonca|japanese|korece|korean|rusca|russian|arapca|arabic|cince|chinese|duolingo|osmanlica"),
  rule(Telescope, "culture", "astronomi|astronomy|yildiz|stars|gokyuzu|teleskop|telescope|gezegen|planet|astrofizik|astrophysics"),
  rule(Rocket, "culture", "uzay|space|roket|rocket|nasa|bilim kurgu|science fiction|sci fi|scifi"),
  rule(Atom, "culture", "bilim|science|fizik|physics|kimya|chemistry|biyoloji|biology|matematik|math|maths|deney|experiment|kuantum|quantum"),
  rule(Drama, "culture", "tiyatro|theatre|theater|opera|muzikal|musical|sahne|oyunculuk|acting|drama|dogaclama|improv|stand up|standup|komedi|comedy"),
  rule(Podcast, "culture", "podcast|podcasts|radyo|radio"),
  rule(Film, "culture", "belgesel|documentary|documentaries"),
  rule(Newspaper, "culture", "haber|news|gazete|newspaper|dergi|magazine|gundem|gazetecilik|journalism"),
  rule(Gem, "culture", "koleksiyon|collecting|collection|antika|antique|mineral|kristal|crystal"),
  rule(Stamp, "culture", "pul |pullar|pul koleksiyon|stamp|stamps|filateli|philately"),
  rule(Coins, "culture", "madeni para|numismatik|numismatics|coin|coins|eski para"),

  // Food and home
  rule(ChefHat, "home", "yemek|cooking|cook |mutfak|kitchen|asci|ascilik|sef |chef|tarif|recipe|recipes|gastronomi|gastronomy"),
  rule(CakeSlice, "home", "pasta|tatli|tatlilar|kek |dessert|desserts|baking|bake|kurabiye|cookie|cookies|cake|cakes|pastacilik"),
  rule(Wheat, "home", "ekmek|bread|eksi maya|sourdough|hamur isi"),
  rule(Coffee, "home", "kahve|coffee|barista|espresso|latte|cay |tea |demleme|brewing"),
  rule(Utensils, "home", "lezzet|gurme|gourmet|food|foodie|restoran|restaurant|street food|tadim|tasting|yeni tatlar"),
  rule(Salad, "home", "saglikli beslen|beslenme|nutrition|diyet|diet|vegan|vejetaryen|vegetarian|salata|healthy|saglikli yasam"),
  rule(Leaf, "home", "bitki|plant|plants|saksi|sukulent|succulent|kaktus|cactus|cicek|flower|flowers|bonsai|houseplant|ev bitki"),
  rule(PawPrint, "home", "hayvan|hayvanlar|animal|animals|pet |pets|evcil|patili|veteriner"),
  rule(Cat, "home", "kedi|kediler|cat |cats"),
  rule(Dog, "home", "kopek|kopekler|kopek egitim|dog |dogs|dog training"),
  rule(Sofa, "home", "dekorasyon|decor|decoration|ic tasarim|interior|ev duzen|mobilya|furniture|home decor"),
  rule(Shirt, "home", "moda|moda tasarim|fashion|fashion design|stil|style|styling|giyim|kiyafet|clothes|outfit|kombin|vintage"),

  // Personal growth
  rule(Flower, "growth", "meditasyon|meditation|mindfulness|farkindalik|zen "),
  rule(Wind, "growth", "nefes|breath|breathwork|breathing"),
  rule(NotebookPen, "growth", "gunluk tut|gunluk yaz|journaling|journal|diary|ani defteri|bullet journal|ajanda"),
  rule(Sunrise, "growth", "sabah rutin|morning routine|rutin|routine|routines|aliskanlik|habit|habits|erken kalk|early riser"),
  rule(ListChecks, "growth", "verimlilik|productivity|zaman yonetim|time management|planlama|planning|organizasyon|organizing|to do|hedef|goal|goals"),
  rule(Rocket, "growth", "girisim|girisimcilik|entrepreneur|startup|startups|is kurmak|business|isletme"),
  rule(GraduationCap, "growth", "online kurs|~kurs|~kurslar|~course|~courses|~egitim|~education|sertifika|udemy|coursera|universite|university|~ders |~ogrenmek|~learning|~study|~studying"),
  rule(Sprout, "growth", "kisisel gelisim|self improvement|self development|personal growth|gelisim|motivasyon|motivation|kendini gelistir|disiplin|discipline"),
  rule(PiggyBank, "growth", "finans|finance|butce|budget|budgeting|tasarruf|saving|savings|birikim|para yonetim|money management"),

  // Social
  rule(HandHeart, "social", "gonullu|gonulluluk|volunteer|volunteering|yardim|charity|hayir|sivil toplum|ngo|dernek|sosyal sorumluluk|bagis|donation"),
  rule(Users, "social", "arkadas|arkadaslar|friends|friend|dost|dostlar|bulusma|hangout|sohbet|muhabbet|aile|family"),
  rule(Handshake, "social", "tanisma|tanismak|yeni insan|networking|meeting new people|topluluk|community|kulup|club|clubs"),
  rule(PartyPopper, "social", "etkinlik|event|events|parti|party|kutlama|celebration|dogum gunu|birthday|davet|hosting"),
  rule(Speech, "social", "munazara|debate|debating|tartisma|hitabet|public speaking|topluluk onunde|sunum|presentation|konusma"),
  rule(HandHelping, "social", "mentor|mentorluk|mentoring|kocluk|coaching|ogretmenlik|teaching|ders vermek|tutor|tutoring|ozel ders"),
];

function bestRule(folded) {
  if (!folded) return null;
  const hay = ` ${folded} `;
  let best = null;
  let bestWeight = 0;
  for (const r of RULES) {
    for (const key of r.keys) {
      if (key.weight > bestWeight && hay.includes(` ${key.text}`)) {
        best = r;
        bestWeight = key.weight;
      }
    }
  }
  return best;
}

// Icon + category for any hobby name: catalog entries keep their own icon,
// typed ones go through the keyword rules, anything else gets Sparkles.
export function hobbyVisual(name) {
  const folded = fold(name);
  const known = ITEM_BY_KEY.get(folded);
  const match = known || bestRule(folded);
  const category = match ? CATEGORY_BY_KEY[match.category] || null : null;
  return {
    icon: match ? match.icon : Sparkles,
    category,
    rgb: category ? category.rgb : DEFAULT_RGB,
  };
}

const wordStart = (key, q) => key.startsWith(q) || ` ${key}`.includes(` ${q}`);

// Catalog entries matching a typed query, best first: the label in the
// viewer's language starts with it / has a word starting with it, then
// entries sharing a keyword rule's icon ("kod" finds "Yazılım"), then a whole
// category by name ("spor", "müzik"), then the other language's label (3+
// letters, so "gi" doesn't surface "Singing", and "spor" lists sports before
// "Maç izlemek" via "Watching sports"), then a match inside a word.
export function searchCatalog(query, lang, limit = 6) {
  const q = fold(query);
  if (!q) return [];
  const long = q.length >= 3;
  const own = lang === "tr" ? 0 : 1;
  const viaRule = bestRule(q);
  const viaCategory = long
    ? new Set(CATEGORIES.filter((c) => [c.tr, c.en, c.shortTr, c.shortEn].some((n) => wordStart(fold(n), q))).map((c) => c.key))
    : null;
  const scored = [];
  CATALOG.forEach((entry, order) => {
    const mine = entry.keys[own];
    const other = entry.keys[1 - own];
    let score;
    if (mine.startsWith(q)) score = 0;
    else if (wordStart(mine, q)) score = 1;
    else if (viaRule && viaRule.icon === entry.icon && viaRule.category === entry.category) score = 2;
    else if (viaCategory && viaCategory.has(entry.category)) score = 3;
    else if (long && wordStart(other, q)) score = 4;
    else if (long && mine.includes(q)) score = 5;
    else return;
    scored.push({ entry, score, order });
  });
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.slice(0, limit).map((s) => s.entry);
}

// Per-character fold (no collapsing), so indexes line up with the label.
const foldChar = (ch) => {
  const f = ch.toLocaleLowerCase("tr-TR").normalize("NFD").replace(MARKS, "").replace(/ı/g, "i");
  return f.length === 1 ? f : ch;
};

// [start, end) of the typed query inside a label, preferring a word start,
// for highlighting autocomplete rows; null when it doesn't appear.
export function matchRange(label, query) {
  const q = Array.from(String(query || "").trim(), foldChar).join("");
  if (!q) return null;
  let hay = "";
  for (let i = 0; i < label.length; i += 1) hay += foldChar(label[i]);
  let from = 0;
  let first = -1;
  for (;;) {
    const at = hay.indexOf(q, from);
    if (at < 0) break;
    if (first < 0) first = at;
    if (at === 0 || hay[at - 1] === " ") return [at, at + q.length];
    from = at + 1;
  }
  return first < 0 ? null : [first, first + q.length];
}
