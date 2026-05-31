import logging
import os
import traceback

from dotenv import load_dotenv
from fastapi import FastAPI, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import speech

load_dotenv()

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("transcribe")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_all_requests(request: Request, call_next):
    logger.info(f">>> {request.method} {request.url}")
    logger.info(f"    headers: {dict(request.headers)}")
    response = await call_next(request)
    logger.info(f"<<< {request.method} {request.url} -> {response.status_code}")
    return response


@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    logger.info(f"[transcribe] file received: name={file.filename}, content_type={file.content_type}")
    content = await file.read()
    logger.info(f"[transcribe] file size: {len(content)} bytes")

    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "(not set)")
    logger.info(f"[transcribe] GOOGLE_APPLICATION_CREDENTIALS={creds_path}")

    try:
        logger.info("[transcribe] creating SpeechClient (REST transport)...")
        client = speech.SpeechClient(transport="rest")
        logger.info("[transcribe] SpeechClient created")

        audio = speech.RecognitionAudio(content=content)
        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
            sample_rate_hertz=48000,
            language_code="en-US",
            enable_automatic_punctuation=True,
        )

        logger.info("[transcribe] calling Google Speech API...")
        response = client.recognize(config=config, audio=audio)
        logger.info(f"[transcribe] got {len(response.results)} results")

        for i, result in enumerate(response.results):
            logger.info(f"[transcribe] result[{i}]: {result.alternatives[0].transcript}")

        transcript = " ".join(
            r.alternatives[0].transcript for r in response.results
        )
        logger.info(f"[transcribe] final transcript: '{transcript}'")
        return {"transcript": transcript}

    except Exception as e:
        logger.error(f"[transcribe] ERROR: {e}")
        logger.error(traceback.format_exc())
        return {"transcript": "", "error": str(e)}


@app.get("/health")
def health():
    logger.info("[health] ok")
    return {"status": "ok"}
