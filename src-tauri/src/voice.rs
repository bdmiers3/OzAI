use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures_util::StreamExt;
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{ipc::Channel, AppHandle, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const MODEL_NAME: &str = "Whisper base.en";
const MODEL_FILENAME: &str = "ggml-base.en.bin";
const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const MODEL_SHA1: &str = "137c40403d78fd54d454da0f9bd998f78703390c";
const MAX_RECORDING_SECONDS: usize = 30;
const TARGET_SAMPLE_RATE: u32 = 16_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    available: bool,
    model_name: String,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceDownloadProgress {
    received_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneDevice {
    id: String,
    label: String,
    is_default: bool,
}

pub struct VoiceState {
    recording: Mutex<Option<RecordingSession>>,
}

impl Default for VoiceState {
    fn default() -> Self {
        Self {
            recording: Mutex::new(None),
        }
    }
}

struct RecordingSession {
    _stream: cpal::Stream,
    samples: Arc<Mutex<Vec<f32>>>,
    stream_error: Arc<Mutex<Option<String>>>,
    sample_rate: u32,
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join("models").join(MODEL_FILENAME))
        .map_err(|error| format!("Oz could not resolve its local model directory: {error}"))
}

fn status_for_path(path: &Path) -> VoiceStatus {
    let available = path
        .metadata()
        .map(|metadata| metadata.len() > 100_000_000)
        .unwrap_or(false);

    VoiceStatus {
        available,
        model_name: MODEL_NAME.to_string(),
        message: if available {
            "Local voice is ready".to_string()
        } else {
            "Local voice model is not installed".to_string()
        },
    }
}

pub fn get_status(app: &AppHandle) -> VoiceStatus {
    model_path(app)
        .map(|path| status_for_path(&path))
        .unwrap_or_else(|error| VoiceStatus {
            available: false,
            model_name: MODEL_NAME.to_string(),
            message: error,
        })
}

pub async fn download_model(
    app: AppHandle,
    on_progress: Channel<VoiceDownloadProgress>,
) -> Result<VoiceStatus, String> {
    let destination = model_path(&app)?;
    if status_for_path(&destination).available {
        return Ok(status_for_path(&destination));
    }

    let parent = destination
        .parent()
        .ok_or_else(|| "Oz could not resolve the voice model folder.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Oz could not create its voice model folder: {error}"))?;

    let temporary = destination.with_extension("download");
    let response = reqwest::Client::new()
        .get(MODEL_URL)
        .send()
        .await
        .map_err(|error| format!("Voice model download could not start: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Voice model download failed: {error}"))?;
    let total = response.content_length();
    let mut stream = response.bytes_stream();
    let mut file = File::create(&temporary)
        .map_err(|error| format!("Oz could not create the model download: {error}"))?;
    let mut received = 0_u64;
    let mut hasher = Sha1::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!("Voice model download was interrupted: {error}")
        })?;
        file.write_all(&chunk).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!("Oz could not save the voice model: {error}")
        })?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        let percent = total.map(|size| ((received.saturating_mul(100) / size).min(100)) as u8);
        let _ = on_progress.send(VoiceDownloadProgress {
            received_bytes: received,
            total_bytes: total,
            percent,
        });
    }

    file.flush()
        .map_err(|error| format!("Oz could not finish saving the voice model: {error}"))?;
    drop(file);

    let actual_hash = format!("{:x}", hasher.finalize());
    if actual_hash != MODEL_SHA1 {
        let _ = fs::remove_file(&temporary);
        return Err("The downloaded voice model failed its integrity check.".to_string());
    }

    if destination.exists() {
        fs::remove_file(&destination)
            .map_err(|error| format!("Oz could not replace the invalid voice model: {error}"))?;
    }
    fs::rename(&temporary, &destination)
        .map_err(|error| format!("Oz could not install the voice model: {error}"))?;
    Ok(status_for_path(&destination))
}

pub fn list_microphones() -> Result<Vec<MicrophoneDevice>, String> {
    let host = cpal::default_host();
    let default_name = host.default_input_device().and_then(|device| device.name().ok());
    let devices = host
        .input_devices()
        .map_err(|error| format!("Oz could not list microphones: {error}"))?;
    let mut result = Vec::new();

    for device in devices {
        if let Ok(label) = device.name() {
            if result
                .iter()
                .any(|candidate: &MicrophoneDevice| candidate.id == label)
            {
                continue;
            }
            result.push(MicrophoneDevice {
                id: label.clone(),
                is_default: default_name.as_deref() == Some(label.as_str()),
                label,
            });
        }
    }

    result.sort_by(|left, right| {
        right
            .is_default
            .cmp(&left.is_default)
            .then_with(|| left.label.cmp(&right.label))
    });
    Ok(result)
}

fn choose_input_device(device_id: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    if let Some(wanted) = device_id.filter(|value| !value.is_empty()) {
        let devices = host
            .input_devices()
            .map_err(|error| format!("Oz could not list microphones: {error}"))?;
        for device in devices {
            if device.name().ok().as_deref() == Some(wanted) {
                return Ok(device);
            }
        }
        return Err("The selected microphone is no longer available.".to_string());
    }

    host.default_input_device()
        .ok_or_else(|| "Windows did not report a default microphone.".to_string())
}

fn push_mono<T: Copy>(
    input: &[T],
    channels: usize,
    samples: &Arc<Mutex<Vec<f32>>>,
    max_frames: usize,
    convert: fn(T) -> f32,
) {
    if let Ok(mut output) = samples.lock() {
        for frame in input.chunks(channels) {
            if output.len() >= max_frames {
                break;
            }
            let mono = frame.iter().copied().map(convert).sum::<f32>() / frame.len() as f32;
            output.push(mono.clamp(-1.0, 1.0));
        }
    }
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    samples: Arc<Mutex<Vec<f32>>>,
    stream_error: Arc<Mutex<Option<String>>>,
    convert: fn(T) -> f32,
) -> Result<cpal::Stream, String>
where
    T: cpal::SizedSample + Copy + Send + 'static,
{
    let channels = config.channels as usize;
    let max_frames = config.sample_rate as usize * MAX_RECORDING_SECONDS;
    let error_slot = stream_error.clone();
    device
        .build_input_stream(
            config,
            move |data: &[T], _| push_mono(data, channels, &samples, max_frames, convert),
            move |error| {
                if let Ok(mut slot) = error_slot.lock() {
                    *slot = Some(error.to_string());
                }
            },
            None,
        )
        .map_err(|error| format!("Oz could not open the microphone: {error}"))
}

pub fn start_recording(
    device_id: Option<String>,
    voice: &VoiceState,
) -> Result<(), String> {
    let mut recording = voice
        .recording
        .lock()
        .map_err(|_| "The microphone state is unavailable.".to_string())?;
    if recording.is_some() {
        return Err("Oz is already listening.".to_string());
    }

    let device = choose_input_device(device_id.as_deref())?;
    let supported = device
        .default_input_config()
        .map_err(|error| format!("Oz could not read the microphone format: {error}"))?;
    let sample_format = supported.sample_format();
    let config = supported.config();
    let samples = Arc::new(Mutex::new(Vec::new()));
    let stream_error = Arc::new(Mutex::new(None));

    let stream = match sample_format {
        cpal::SampleFormat::F32 => build_stream(
            &device,
            &config,
            samples.clone(),
            stream_error.clone(),
            |sample: f32| sample,
        )?,
        cpal::SampleFormat::I16 => build_stream(
            &device,
            &config,
            samples.clone(),
            stream_error.clone(),
            |sample: i16| sample as f32 / i16::MAX as f32,
        )?,
        cpal::SampleFormat::U16 => build_stream(
            &device,
            &config,
            samples.clone(),
            stream_error.clone(),
            |sample: u16| sample as f32 / u16::MAX as f32 * 2.0 - 1.0,
        )?,
        unsupported => {
            return Err(format!(
                "The microphone uses an unsupported sample format: {unsupported:?}"
            ))
        }
    };

    stream
        .play()
        .map_err(|error| format!("Oz could not start microphone capture: {error}"))?;
    *recording = Some(RecordingSession {
        _stream: stream,
        samples,
        stream_error,
        sample_rate: config.sample_rate,
    });
    Ok(())
}

fn resample_linear(input: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if source_rate == target_rate {
        return input.to_vec();
    }
    let output_length =
        ((input.len() as u64 * target_rate as u64) / source_rate as u64) as usize;
    let source_step = source_rate as f64 / target_rate as f64;
    let mut output = Vec::with_capacity(output_length);

    for index in 0..output_length {
        let source_position = index as f64 * source_step;
        let left = source_position.floor() as usize;
        let right = (left + 1).min(input.len().saturating_sub(1));
        let fraction = (source_position - left as f64) as f32;
        output.push(input[left] * (1.0 - fraction) + input[right] * fraction);
    }
    output
}

fn transcribe(model: PathBuf, samples: Vec<f32>, sample_rate: u32) -> Result<String, String> {
    let audio = resample_linear(&samples, sample_rate, TARGET_SAMPLE_RATE);
    let context = WhisperContext::new_with_params(
        &model,
        WhisperContextParameters::default(),
    )
    .map_err(|error| format!("Oz could not load the local voice model: {error}"))?;
    let mut state = context
        .create_state()
        .map_err(|error| format!("Oz could not initialize transcription: {error}"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    let threads = std::thread::available_parallelism()
        .map(|count| count.get().min(8) as i32)
        .unwrap_or(4);
    params.set_n_threads(threads);
    params.set_language(Some("en"));
    params.set_translate(false);
    params.set_no_context(true);
    params.set_no_timestamps(true);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);

    state
        .full(params, &audio)
        .map_err(|error| format!("Local transcription failed: {error}"))?;
    let transcript = state
        .as_iter()
        .map(|segment| segment.to_string())
        .collect::<String>()
        .trim()
        .to_string();

    if transcript.is_empty() {
        Err("Oz did not detect speech. Hold the button and try again.".to_string())
    } else {
        Ok(transcript)
    }
}

pub async fn stop_and_transcribe(
    app: AppHandle,
    voice: &VoiceState,
) -> Result<String, String> {
    let session = voice
        .recording
        .lock()
        .map_err(|_| "The microphone state is unavailable.".to_string())?
        .take()
        .ok_or_else(|| "Oz is not currently listening.".to_string())?;

    drop(session._stream);
    if let Some(error) = session
        .stream_error
        .lock()
        .map_err(|_| "The microphone error state is unavailable.".to_string())?
        .take()
    {
        return Err(format!("Microphone capture stopped: {error}"));
    }

    let samples = session
        .samples
        .lock()
        .map_err(|_| "The recorded audio is unavailable.".to_string())?
        .clone();
    if samples.len() < (session.sample_rate as usize / 4) {
        return Err("The recording was too short. Hold the button while speaking.".to_string());
    }

    let model = model_path(&app)?;
    if !status_for_path(&model).available {
        return Err("Install the local voice model before using push-to-talk.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        transcribe(model, samples, session.sample_rate)
    })
    .await
    .map_err(|error| format!("The transcription task stopped unexpectedly: {error}"))?
}
