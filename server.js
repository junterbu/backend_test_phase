import express from "express";
import fileUpload from "express-fileupload";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db.js";
import { put, list } from "@vercel/blob";

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

// Initialer Start eines Nutzers (nach Eingabe der Matrikelnummer)
app.get("/api/quiz/start/:userId", async (req, res) => {
    const userId = req.params.userId;

    try {
        // Prüfen ob Nutzer bereits in quiz_fragen existiert
        const fragenResult = await pool.query("SELECT fragen FROM quiz_fragen WHERE user_id = $1", [userId]);
        let fragen = fragenResult.rows[0]?.fragen || [];

        // Falls nicht vorhanden, neue Fragen generieren und speichern
        if (!fragen.length) {
            fragen = quizFragen.sort(() => Math.random() - 0.5).slice(0, 7);
            await pool.query("INSERT INTO quiz_fragen (user_id, fragen) VALUES ($1, $2)", [userId, fragen]);
        }

        // Prüfen ob Nutzer in quiz_ergebnisse existiert, sonst anlegen
        const ergebnisResult = await pool.query("SELECT beantwortete_fragen FROM quiz_ergebnisse WHERE user_id = $1", [userId]);
        let beantwortet = ergebnisResult.rows[0]?.beantwortete_fragen;

        if (!ergebnisResult.rows.length) {
            await pool.query("INSERT INTO quiz_ergebnisse (user_id, punkte, beantwortete_fragen) VALUES ($1, 0, $2)", [userId, JSON.stringify([])]);
            beantwortet = [];
        }

        // Nächste unbeantwortete Frage finden
        const nochOffen = fragen.find(f => !(beantwortet || []).some(b => b.raum === f));

        if (!nochOffen) {
            return res.status(200).json({ done: true, message: "Alle Fragen beantwortet!" });
        }

        res.status(200).json({ frage: nochOffen });
    } catch (error) {
        console.error("❌ Fehler beim Quizstart:", error);
        res.status(500).json({ error: "Quizstart fehlgeschlagen" });
    }
});

// Speicherung einer beantworteten Frage
app.post("/api/quiz", async (req, res) => {
    try {
        const { userId, raum, auswahl, frage, richtigeAntwort, punkte } = req.body;

        const { rows } = await pool.query("SELECT beantwortete_fragen, punkte FROM quiz_ergebnisse WHERE user_id = $1", [userId]);
        let beantworteteFragen = rows[0]?.beantwortete_fragen || [];
        let bisherigePunkte = rows[0]?.punkte || 0;

        if (!beantworteteFragen.some(f => f.raum === raum)) {
            beantworteteFragen.push({ raum, frage, gegebeneAntwort: auswahl, richtigeAntwort, punkte });
            bisherigePunkte += punkte;

            await pool.query(
                "UPDATE quiz_ergebnisse SET beantwortete_fragen = $1, punkte = $2 WHERE user_id = $3",
                [JSON.stringify(beantworteteFragen), bisherigePunkte, userId]
            );
        }

        res.status(200).json({ message: "Antwort gespeichert", punkte: bisherigePunkte });
    } catch (error) {
        console.error("❌ Fehler beim Speichern der Quiz-Daten:", error);
        res.status(500).json({ error: "Fehler beim Speichern" });
    }
});

// Abschlussroute: Speichere Endergebnis in labor_ergebnisse
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
        console.error("❌ Fehler beim Speichern in labor_ergebnisse:", error);
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
        console.error("❌ CSV-Fehler:", error);
    }
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server läuft auf Port ${PORT}`));
