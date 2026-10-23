"""Run from the repo: bun scripts/heavy.ts -- python codecs/jpeg-xl/build.py"""
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SCRATCH = ROOT / "tmp/jxl-codec-build"
JXL_REV = "a7a9c787341cf703dede03c2009fa460cae5e5df"  # v0.12.0
EMSDK_REV = "d7b4130688bfa348392b921ab04015aa15c4f154"
SDK_VERSION = "4.0.23"


def run(*args, env=None):
    subprocess.run([str(arg) for arg in args], cwd=ROOT, env=env, check=True)


def checkout(name, url, revision):
    path = SCRATCH / name
    if not (path / ".git").exists():
        run("git", "clone", "--no-checkout", "--filter=blob:none", url, path)
    current = subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()
    if current != revision:
        run("git", "-C", path, "checkout", "--detach", revision)
    return path


def main():
    SCRATCH.mkdir(parents=True, exist_ok=True)
    source = checkout("libjxl", "https://github.com/libjxl/libjxl.git", JXL_REV)
    for name in ("libjxl-memory.patch", "libjxl-dc.patch"):
        patch = ROOT / "codecs/jpeg-xl" / name
        applied = subprocess.run(["git", "-C", str(source), "apply", "--reverse", "--check", str(patch)],
                                 capture_output=True).returncode == 0
        if not applied:
            run("git", "-C", source, "apply", patch)
    run("git", "-C", source, "submodule", "update", "--init", "--depth", "1", "--",
        "third_party/brotli", "third_party/highway", "third_party/skcms")
    sdk = checkout("emsdk", "https://github.com/emscripten-core/emsdk.git", EMSDK_REV)
    run(sys.executable, sdk / "emsdk.py", "install", SDK_VERSION)
    run(sys.executable, sdk / "emsdk.py", "activate", SDK_VERSION)
    env = os.environ.copy()
    env["EMSDK"] = str(sdk)
    env["EM_CONFIG"] = str(sdk / ".emscripten")
    env["EMSDK_PYTHON"] = sys.executable
    env["PATH"] = str(sdk / "upstream/emscripten") + os.pathsep + env["PATH"]
    build = SCRATCH / "build"
    run(sys.executable, sdk / "upstream/emscripten/emcmake.py", "cmake", "-G", "Ninja",
        "-S", ROOT / "codecs/jpeg-xl", "-B", build, "-DCMAKE_BUILD_TYPE=Release",
        f"-DLIBJXL_SOURCE={source.as_posix()}", "-DCMAKE_C_FLAGS=-O3 -msimd128",
        "-DCMAKE_CXX_FLAGS=-O3 -msimd128", env=env)
    run("cmake", "--build", build, "--target", "bluewing-jxl", "--parallel", "2", env=env)
    assets = ROOT / "assets/jpeg-xl"
    assets.mkdir(parents=True, exist_ok=True)
    for suffix in ("js", "wasm"):
        shutil.copyfile(build / f"bluewing-jxl.{suffix}", assets / f"bluewing-jxl.{suffix}")
    licenses = assets / "licenses"
    licenses.mkdir(exist_ok=True)
    for name, path in {
        "libjxl": source / "LICENSE",
        "libjxl-PATENTS": source / "PATENTS",
        "brotli": source / "third_party/brotli/LICENSE",
        "highway": source / "third_party/highway/LICENSE",
        "skcms": source / "third_party/skcms/LICENSE",
        "emscripten": sdk / "upstream/emscripten/LICENSE",
    }.items():
        shutil.copyfile(path, licenses / f"{name}.txt")
    shutil.copyfile(ROOT / "codecs/jpeg-xl/NOTICE.txt", licenses / "bluewing-modifications.txt")


if __name__ == "__main__":
    main()
