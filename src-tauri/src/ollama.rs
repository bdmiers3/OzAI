use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::ipc::Channel;

const OLLAMA_BASE_URL: &str = "http://127.0.0.1:11434";
const MAX_QUESTION_LENGTH: usize = 8_000;
const MAX_SCREEN_BASE64_LENGTH: usize = 40 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskRequest {
    question: String,
    model: String,
    screen: Option<ScreenInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScreenInput {
    base64_png: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    available: bool,
    model: String,
    message: String,
}

#[derive(Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<ModelTag>,
}

#[derive(Deserialize)]
struct ModelTag {
    name: String,
}

#[derive(Deserialize)]
struct StreamChunk {
    message: Option<StreamMessage>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct StreamMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct OllamaError {
    error: Option<String>,
}

pub async fn get_status(model: String) -> ModelStatus {
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(4))
        .build()
    {
        Ok(client) => client,
        Err(_) => return unavailable(model, "Oz could not initialize its local model client."),
    };

    let response = match client
        .get(format!("{OLLAMA_BASE_URL}/api/tags"))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            return unavailable(
                model,
                &format!("Ollama returned status {}.", response.status()),
            )
        }
        Err(_) => return unavailable(model, "Ollama is not connected."),
    };

    let tags = match response.json::<TagsResponse>().await {
        Ok(tags) => tags,
        Err(_) => return unavailable(model, "Ollama returned an unreadable model list."),
    };
    let installed = tags.models.iter().any(|candidate| {
        candidate.name == model || candidate.name == format!("{model}:latest")
    });

    if installed {
        ModelStatus {
            available: true,
            message: format!("{model} is ready"),
            model,
        }
    } else {
        unavailable(
            model.clone(),
            &format!("Ollama is running, but {model} is not installed."),
        )
    }
}

pub async fn stream_answer(
    request: AskRequest,
    on_token: Channel<String>,
) -> Result<(), String> {
    let question = request.question.trim();
    if question.is_empty() {
        return Err("Enter a question for Oz.".to_string());
    }
    if question.len() > MAX_QUESTION_LENGTH {
        return Err("That question is too long for this version of Oz.".to_string());
    }
    if request.model.trim().is_empty() {
        return Err("No local model is selected.".to_string());
    }

    let images = match request.screen {
        Some(screen) => {
            if screen.base64_png.len() > MAX_SCREEN_BASE64_LENGTH {
                return Err("The screenshot is too large to process safely.".to_string());
            }
            vec![screen.base64_png]
        }
        None => Vec::new(),
    };

    let user_message = if images.is_empty() {
        serde_json::json!({
            "role": "user",
            "content": question
        })
    } else {
        serde_json::json!({
            "role": "user",
            "content": question,
            "images": images
        })
    };

    let body = serde_json::json!({
        "model": request.model,
        "stream": true,
        "think": false,
        "keep_alive": "5m",
        "messages": [
            {
                "role": "system",
                "content": "You are Oz, a concise desktop assistant. Use the supplied screenshot when relevant. Never claim to see details that are not visible. When explaining an interface, give clear, actionable steps."
            },
            user_message
        ]
    });

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| format!("Oz could not initialize its local model client: {error}"))?;

    let mut response = client
        .post(format!("{OLLAMA_BASE_URL}/api/chat"))
        .json(&body)
        .send()
        .await
        .map_err(|_| {
            "Oz could not reach Ollama. Make sure the Ollama app is running.".to_string()
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let details = response
            .json::<OllamaError>()
            .await
            .ok()
            .and_then(|payload| payload.error)
            .unwrap_or_else(|| format!("Ollama returned status {status}."));
        return Err(details);
    }

    let mut buffer = Vec::<u8>::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("The local response stream stopped: {error}"))?
    {
        buffer.extend_from_slice(&chunk);
        while let Some(newline) = buffer.iter().position(|byte| *byte == b'\n') {
            let line = buffer.drain(..=newline).collect::<Vec<_>>();
            send_stream_line(&line, &on_token)?;
        }
    }

    if !buffer.is_empty() {
        send_stream_line(&buffer, &on_token)?;
    }

    Ok(())
}

fn send_stream_line(line: &[u8], on_token: &Channel<String>) -> Result<(), String> {
    let line = line.strip_suffix(b"\n").unwrap_or(line);
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    if line.is_empty() {
        return Ok(());
    }

    let chunk = serde_json::from_slice::<StreamChunk>(line)
        .map_err(|error| format!("Ollama returned an unreadable response: {error}"))?;
    if let Some(error) = chunk.error {
        return Err(error);
    }
    if let Some(content) = chunk.message.and_then(|message| message.content) {
        if !content.is_empty() {
            on_token
                .send(content)
                .map_err(|error| format!("Oz could not display the response: {error}"))?;
        }
    }
    Ok(())
}

fn unavailable(model: String, message: &str) -> ModelStatus {
    ModelStatus {
        available: false,
        model,
        message: message.to_string(),
    }
}
