import express from "express";
import fileUpload from "express-fileupload";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db.js";
import { put, list } from "@vercel/blob"; // Vercel Blob für PDF/CSV

const CSV_FILE_NAME = "labor_ergebnisse.csv";
const STORAGE_BUCKET = "virtuelles-labor-pdf-storage";

dotenv.config();
const __dirname = path.resolve();
const app = express();

const corsOptions = {
    origin: "*",
    methods: "GET,POST,OPTIONS",
    allowedHeaders: "Content-Type"
};

const quizFragen = [
    "Gesteinsraum", "Rohdichte", "Mischer", "Marshall",
    "Pyknometer", "Hohlraumgehalt", "ÖNORM EN 12697-8",
    "NaBe", "WPK", "Grenzsieblinien", "Raumdichte"
];

app.use(cors(corsOptions));
app.use(fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get("/", (req, res) => {
    res.json({ message: "Backend läuft erfolgreich auf Vercel! 🚀" });
});

app.get("/test", (req, res) => {
    res.json({ message: "CORS funktioniert!" });
});

app.get("/api/data/:userId", async (req, res) => {
    try {
        const userId = req.params.userId;
        const { rows } = await pool.query(
            "SELECT * FROM quiz_ergebnisse WHERE user_id = $1",
            [userId]
        );
        res.status(200).json(rows[0] || {});
    } catch (error) {
        res.status(500).json({ error: "Fehler beim Abrufen der Daten" });
    }
});

app.post("/api/quiz", async (req, res) => {
    try {
        const { userId, raum, auswahl } = req.body;

        const { rows } = await pool.query(
            "SELECT * FROM quiz_ergebnisse WHERE user_id = $1",
            [userId]
        );

        let beantworteteFragen = rows[0]?.beantwortete_fragen || [];
        let punkte = rows[0]?.punkte || 0;
        const quizDaten = {
            "Gesteinsraum": { frage: "Welche Aussage zur CE-Kennzeichnung von Asphaltmischgut ist korrekt?", antwort: "Sie zeigt an, dass gesetzliche Vorschriften eingehalten wurden", punkte: 10 },
            "Mischer": { frage: "Warum ist eine Typprüfung von Asphaltmischgut notwendig?", antwort: "Um die normgemäßen Anforderungen an das Mischgut zu überprüfen", punkte: 10 },
            "Marshall": { frage: "Wie wird der optimale Bindemittelgehalt eines Asphaltmischguts ermittelt?", antwort: "Durch Erstellen einer Polynomfunktion und Finden des Maximums der Raumdichten", punkte: 10 },
            "Rohdichte": { frage: "Mit welchem volumetrischen Kennwert wird die maximale Dichte eines Asphaltmischguts ohne Hohlräume beschrieben?", antwort: "Rohdichte", punkte: 10 },
            "Pyknometer": { frage: "Wofür steht die Masse m_2 im Volumetrischen Verfahren zur Ermittlung der Rohdichte nach ÖNORM EN 12697-8?", antwort: "Masse des Pyknometers mit Aufsatz, Feder und Laborprobe", punkte: 10 },
            "Hohlraumgehalt": { frage: "Ab wie viel % Hohlraumgehalt ist Verfahren D: Raumdichte durch Ausmessen der ÖNORM EN 12697-6 empfohlen?", antwort: "Ab 10%", punkte: 10 },
            "ÖNORM EN 12697-8": { frage: "Wie wird der Hohlraumgehalt eines Probekörpers nach ÖNORM EN 12697-8 ermittelt?", antwort: "Aus der Differenz von Raumdichte und Rohdichte", punkte: 10 },
            "NaBe": { frage: "Wie viele Recyclingasphalt muss ein Asphaltmischgut gemäß „Aktionsplan nachhaltige öffentlichen Beschaffung (naBe)“ mindestens enthalten?", antwort: "10M%", punkte: 10 },
            "WPK": { frage: "Wozu dient die Werkseigene Produktionskontrolle (WPK)?", antwort: "Zur Qualitätssicherung während der Produktion in Eigenüberwachung", punkte: 10 },
            "Grenzsieblinien": { frage: "Wo findet man Grenzsieblinien von Asphaltmischgütern?", antwort: "In den Produktanforderungen für Asphaltmischgut (ÖNORM B 358x-x)", punkte: 10 },
            "Raumdichte": {frage: "Welche Verfahren zur Bestimmung der Raumdichte von Asphaltprobekörpern nach ÖNORM EN 12697-6 sind für dichte Probekörper bis etwa 7% Hohlraumgehalt geeignet?", antwort: "Verfahren A: Raumdichte — trocken und Verfahren B: Raumdichte — SSD ", punkte: 10 }
        };

        if (!beantworteteFragen.some(q => q.raum === raum)) {
            const korrekt = quizDaten[raum]?.antwort === auswahl;
            const neuePunkte = korrekt ? quizDaten[raum].punkte : 0;

            beantworteteFragen.push({
                raum,
                frage: quizDaten[raum]?.frage,
                gegebeneAntwort: auswahl,
                richtigeAntwort: quizDaten[raum]?.antwort,
                punkte: neuePunkte
            });

            punkte += neuePunkte;
        }

        await pool.query(
            `INSERT INTO quiz_ergebnisse (user_id, punkte, beantwortete_fragen)
                VALUES ($1, $2, $3)
                ON CONFLICT (user_id) DO UPDATE SET punkte = $2, beantwortete_fragen = $3`,
            [userId, punkte, JSON.stringify(beantworteteFragen)]
        );

        res.status(200).json({ message: "Quiz-Daten gespeichert!", punkte });
    } catch (error) {
        res.status(500).json({ error: "Fehler beim Speichern der Quiz-Daten" });
    }
});


app.get("/api/punkte/:userId", async (req, res) => {
    try {
        const userId = req.params.userId;
        const { rows } = await pool.query("SELECT punkte FROM quiz_ergebnisse WHERE user_id = $1", [userId]);
        res.status(200).json({ punkte: rows[0]?.punkte || 0 });
    } catch (error) {
        res.status(500).json({ error: "Fehler beim Abrufen der Punkte" });
    }
});

app.get("/api/quizfragen/:userId", async (req, res) => {
    try {
        const userId = req.params.userId;
        const { rows } = await pool.query("SELECT fragen FROM quiz_fragen WHERE user_id = $1", [userId]);

        if (rows.length > 0) {
            return res.status(200).json({ fragen: rows[0].fragen });
        }

        const zufallsFragen = quizFragen.sort(() => Math.random() - 0.5).slice(0, 7);
        await pool.query("INSERT INTO quiz_fragen (user_id, fragen) VALUES ($1, $2)", [userId, zufallsFragen]);

        res.status(200).json({ fragen: zufallsFragen });
    } catch (error) {
        res.status(500).json({ error: "Fehler beim Abrufen der Fragen" });
    }
});

app.get("/api/beantworteteFragen/:userId", async (req, res) => {
    try {
        const userId = req.params.userId;
        const { rows } = await pool.query("SELECT beantwortete_fragen FROM quiz_ergebnisse WHERE user_id = $1", [userId]);
        res.status(200).json({ fragen: rows[0]?.beantwortete_fragen || [] });
    } catch (error) {
        res.status(500).json({ error: "Fehler beim Abrufen der Fragen" });
    }
});

app.get("/api/quizErgebnisse/:userId", async (req, res) => {
    try {
        const userId = req.params.userId;
        const { rows } = await pool.query("SELECT beantwortete_fragen, punkte FROM quiz_ergebnisse WHERE user_id = $1", [userId]);
        res.status(200).json({ ergebnisse: rows[0]?.beantwortete_fragen || [], gesamtPunkte: rows[0]?.punkte || 0 });
    } catch (error) {
        res.status(500).json({ error: "Fehler beim Abrufen der Quiz-Ergebnisse" });
    }
});

app.post("/api/uploadPDF", async (req, res) => {
    try {
        if (!req.files || !req.files.pdf) {
            return res.status(400).json({ error: "Kein PDF gefunden" });
        }
        const userId = req.body.userId;
        const fileName = `Laborberichte/Pruefbericht_${userId}.pdf`;
        const blobs = await list();
        const existingPDF = blobs.blobs.find(blob => blob.pathname === fileName);

        if (existingPDF) {
            return res.status(200).json({ message: "PDF bereits gespeichert", url: existingPDF.url });
        }

        const uploadResult = await put(fileName, req.files.pdf.data, {
            access: "public",
            contentType: "application/pdf"
        });

        res.status(200).json({ message: "PDF gespeichert", url: uploadResult.url });
    } catch (error) {
        res.status(500).json({ error: "Fehler beim Speichern des PDFs" });
    }
});

app.post("/api/storeResults", async (req, res) => {
    try {
        const { userId, punkte, optimalerBitumengehalt, maximaleRaumdichte } = req.body;

        await pool.query(
            `INSERT INTO labor_ergebnisse (user_id, punkte, optimaler_bitumengehalt, maximale_raumdichte, timestamp)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (user_id) DO UPDATE SET punkte = $2, optimaler_bitumengehalt = $3, maximale_raumdichte = $4, timestamp = NOW()`,
            [userId, punkte, optimalerBitumengehalt, maximaleRaumdichte]
        );

        await appendToCSV(userId, punkte, optimalerBitumengehalt, maximaleRaumdichte);
        res.status(200).json({ message: "Ergebnisse gespeichert" });
    } catch (error) {
        res.status(500).json({ error: "Fehler beim Speichern" });
    }
});

async function appendToCSV(userId, punkte, optimalerBitumengehalt, maximaleRaumdichte) {
    try {
        let csvContent = "Matrikelnummer,Quiz-Punkte,Optimaler Bitumengehalt,Maximale Raumdichte,Datum\n";
        let userExists = false;
        const blobs = await list();
        const existingBlob = blobs.blobs.find(blob => blob.pathname === CSV_FILE_NAME);

        if (existingBlob) {
            const response = await fetch(existingBlob.url);
            const csvLines = (await response.text()).split("\n");
            userExists = csvLines.some(line => line.startsWith(userId + ","));
            if (userExists) return;
            csvContent = csvLines.join("\n");
        }

        const neueZeile = `${userId},${punkte},${optimalerBitumengehalt},${maximaleRaumdichte},${new Date().toISOString()}`;
        csvContent += `\n${neueZeile}`;

        await put(CSV_FILE_NAME, csvContent, {
            access: "public",
            contentType: "text/csv",
        });
    } catch (error) {
        console.error("CSV-Fehler:", error);
    }
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server läuft auf Port ${PORT}`));