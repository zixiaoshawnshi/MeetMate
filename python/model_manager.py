"""
Utility script for downloading and validating local diarization models.

Usage:
  python model_manager.py download --repo-id pyannote/embedding --dest <path> --token <hf_token>
  python model_manager.py validate --path <path>
"""

import argparse
import json
import shutil
from pathlib import Path

from huggingface_hub import snapshot_download


def cmd_download(repo_id: str, dest: str, token: str) -> dict:
    out_dir = Path(dest).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    snapshot_download(
        repo_id=repo_id,
        token=token,
        local_dir=str(out_dir),
        local_dir_use_symlinks=False,
    )

    return {
        "ok": True,
        "message": f"Downloaded {repo_id} to {out_dir}",
        "path": str(out_dir),
    }


def cmd_validate(path: str) -> dict:
    model_path = Path(path).resolve()
    if not model_path.exists():
        return {"ok": False, "message": f"Model path does not exist: {model_path}"}
    if shutil.which("ffmpeg") is None:
        return {
            "ok": False,
            "message": "ffmpeg not found on PATH. Install ffmpeg first.",
            "path": str(model_path),
        }

    try:
        from pyannote.audio import Inference, Model

        model = Model.from_pretrained(str(model_path))
        _ = Inference(model, window="whole")
        return {
            "ok": True,
            "message": "Local diarization model loaded successfully.",
            "path": str(model_path),
        }
    except Exception as exc:
        return {
            "ok": False,
            "message": f"Failed to load local model: {exc}",
            "path": str(model_path),
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_dl = sub.add_parser("download")
    p_dl.add_argument("--repo-id", required=True)
    p_dl.add_argument("--dest", required=True)
    p_dl.add_argument("--token", required=True)

    p_val = sub.add_parser("validate")
    p_val.add_argument("--path", required=True)

    args = parser.parse_args()

    try:
        if args.cmd == "download":
            result = cmd_download(args.repo_id, args.dest, args.token)
        else:
            result = cmd_validate(args.path)
    except Exception as exc:
        result = {"ok": False, "message": str(exc)}

    print(json.dumps(result))


if __name__ == "__main__":
    main()
