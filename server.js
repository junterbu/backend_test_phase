import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import fileUpload from "express-fileupload";
import fs from "fs";
import path from "path";
import { put, list } from "@vercel/blob";
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const CSV_FILE_NAME = "labor_ergebnisse.csv";
const STORAGE_BUCKET = "virtuelles-labor-pdf-storage";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const app = express();
app.use(cors());
app.use(express.json());
app.use(fileUpload());

const quizFragen = [
  "Gesteinsraum", "Rohdichte", "Mischer", "Marshall", "Pyknometer",
  "Hohlraumgehalt", "ÖNORM EN 12697-8", "NaBe", "WPK", "Grenzsieblinien", "Raumdichte"
];

app.get("/", (_, res) => res.send("Backend läuft!"));

app.get("/test", (_, res) => res.json({ message: "Test erfolgreich" }));

app.get("/api/data/:userId", async (req, res) => {
  const { userId } = req.params;
  let { data: user, error } = await supabase
    .from('user_data')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message });

  if (!user) {
    const insertResult = await supabase.from('user_data').insert([{ user_id: userId }]).select().single();
    if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
    user = insertResult.data;
  }

  const { data: vorhandeneFragen, error: fragenError } = await supabase
    .from('quiz_fragen')
    .select('*')
    .eq('user_id', userId);

  if (fragenError) return res.status(500).json({ error: fragenError.message });

  if (vorhandeneFragen.length < 7) {
    const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);
    const ausgewählteFragen = shuffle(quizFragen).slice(0, 7);
    const einträge = ausgewählteFragen.map(f => ({ user_id: userId, fragen: f }));
    const { error: insertFragenError } = await supabase.from('quiz_fragen').insert(einträge);
    if (insertFragenError) return res.status(500).json({ error: insertFragenError.message });
  }

  res.json(user);
});

app.get("/api/quizfragen/:userId", async (req, res) => {
  const { userId } = req.params;

  const { data: beantwortet, error: error1 } = await supabase
    .from('quiz_ergebnisse')
    .select('beantwortete_fragen')
    .eq('user_id', userId);

  if (error1) return res.status(500).json({ error: error1.message });
  const beantworteteFragen = beantwortet.map(e => e.beantwortete_fragen);

  const { data: alleFragen, error: error2 } = await supabase
    .from('quiz_fragen')
    .select('fragen')
    .eq('user_id', userId);

  if (error2) return res.status(500).json({ error: error2.message });

  const unbeantwortet = alleFragen
    .map(f => f.fragen)
    .filter(fragen => !beantworteteFragen.includes(fragen));

  const fragen = unbeantwortet.slice(0, 2);
  res.json({ fragen });
});

app.post("/api/quiz", async (req, res) => {
    const { userId, raum, antwort, punkte } = req.body;
  
    if (!userId || !raum || !antwort || punkte === undefined) {
      return res.status(400).json({ error: "Ungültige Eingabedaten" });
    }
  
    const eintrag = {
      user_id: userId,
      beantwortete_fragen: raum,
      antwort: antwort,
      punkte: punkte
    };
  
    const { error } = await supabase.from('quiz_ergebnisse').insert([eintrag]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "Antwort gespeichert" });
});

app.get("/api/punkte/:userId", async (req, res) => {
  const { userId } = req.params;
  const { data, error } = await supabase
    .from('quiz_ergebnisse')
    .select('punkte')
    .eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  const punkte = data.filter(x => x.punkte).length*10;
  res.json({ punkte });
});

app.get("/api/beantworteteFragen/:userId", async (req, res) => {
  const { userId } = req.params;
  const { data, error } = await supabase
    .from('quiz_ergebnisse')
    .select('beantwortete_fragen')
    .eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  const beantwortet = data.map(x => x.beantwortete_fragen);
  res.json({ beantwortet });
});

app.get("/api/quizErgebnisse/:userId", async (req, res) => {
  const { userId } = req.params;
  const { data, error } = await supabase
    .from('quiz_ergebnisse')
    .select('*')
    .eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/uploadPDF", async (req, res) => {
  if (!req.files || !req.files.pdf) return res.status(400).send("Keine Datei hochgeladen.");
  const pdf = req.files.pdf;
  const filePath = path.join("/tmp", pdf.name);
  await pdf.mv(filePath);
  const blob = await put(`${Date.now()}_${pdf.name}`, fs.readFileSync(filePath), { access: 'public' });
  res.json({ url: blob.url });
});

app.post("/api/storeResults/", async (req, res) => {
    const { userId, punkte, optimalerBitumengehalt, maximaleRaumdichte } = req.body;
  
  const eintrag = {
    user_id: userId,
    punkte: punkte,
    optimaler_bitumengehalt: optimalerBitumengehalt,
    maximale_raumdichte: maximaleRaumdichte
  };

  const { error } = await supabase.from('labor_ergebnisse').insert([eintrag]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Ergebnis gespeichert" });
});

export default app;
