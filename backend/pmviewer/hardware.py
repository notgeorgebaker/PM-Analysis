"""Host hardware detection and a compute-allocation config.

Meon Spring maps itself to the host: it reports the CPU cores, memory and any
NVIDIA GPUs it can see, and lets the user choose how many CPU cores and which
GPU accelerators to use. The choices are then genuinely applied:

  * CPU  -> BLAS/OpenMP thread pools are capped (via threadpoolctl + env), which
            controls the parallelism of the numpy-heavy analyses (distance
            matrices, HELANAL SVDs, contact searches, …) and the worker count
            used by frame-parallel routines.
  * GPU  -> when CuPy + CUDA are present, large array maths (distance/contact
            kernels) can run on the selected device; otherwise it transparently
            falls back to CPU.

Everything degrades gracefully: with no GPU (or no CuPy) the GPU options are
simply reported as unavailable, and detection never hard-depends on psutil,
pynvml, CuPy or torch.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any

# ---------------------------------------------------------------------------
# CPU / memory detection
# ---------------------------------------------------------------------------


def _logical_cpus() -> int:
    # honour cgroup/affinity limits when present (containers, schedulers)
    if hasattr(os, "sched_getaffinity"):
        try:
            return len(os.sched_getaffinity(0))
        except OSError:
            pass
    return os.cpu_count() or 1


def _physical_cpus() -> int | None:
    try:
        import psutil

        n = psutil.cpu_count(logical=False)
        if n:
            return int(n)
    except Exception:
        pass
    # stdlib fallback: count unique (physical id, core id) pairs on Linux
    try:
        with open("/proc/cpuinfo") as fh:
            pairs, phys, core = set(), None, None
            for line in fh:
                if line.startswith("physical id"):
                    phys = line.split(":")[1].strip()
                elif line.startswith("core id"):
                    core = line.split(":")[1].strip()
                elif line.strip() == "" and phys is not None and core is not None:
                    pairs.add((phys, core))
                    phys = core = None
            if pairs:
                return len(pairs)
    except OSError:
        pass
    return None


def _cpu_model() -> str:
    try:
        with open("/proc/cpuinfo") as fh:
            for line in fh:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or platform.machine() or "Unknown CPU"


def _memory_gb() -> float | None:
    try:
        import psutil

        return round(psutil.virtual_memory().total / 1e9, 1)
    except Exception:
        pass
    try:
        with open("/proc/meminfo") as fh:
            for line in fh:
                if line.startswith("MemTotal"):
                    kb = int(line.split()[1])
                    return round(kb * 1024 / 1e9, 1)
    except OSError:
        pass
    return None


# ---------------------------------------------------------------------------
# GPU / CUDA detection
# ---------------------------------------------------------------------------


def _gpus_via_pynvml() -> list[dict[str, Any]] | None:
    try:
        import pynvml

        pynvml.nvmlInit()
        out = []
        for i in range(pynvml.nvmlDeviceGetCount()):
            h = pynvml.nvmlDeviceGetHandleByIndex(i)
            mem = pynvml.nvmlDeviceGetMemoryInfo(h)
            name = pynvml.nvmlDeviceGetName(h)
            out.append({
                "index": i,
                "name": name.decode() if isinstance(name, bytes) else name,
                "memory_mb": int(mem.total / (1024 * 1024)),
                "memory_used_mb": int(mem.used / (1024 * 1024)),
            })
        pynvml.nvmlShutdown()
        return out
    except Exception:
        return None


def _gpus_via_smi() -> list[dict[str, Any]]:
    if not shutil.which("nvidia-smi"):
        return []
    try:
        out = subprocess.run(
            ["nvidia-smi",
             "--query-gpu=index,name,memory.total,memory.used,utilization.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
    except Exception:
        return []
    gpus = []
    for line in out.stdout.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 5:
            gpus.append({
                "index": int(parts[0]), "name": parts[1],
                "memory_mb": int(float(parts[2])), "memory_used_mb": int(float(parts[3])),
                "utilization_pct": int(float(parts[4])),
            })
    return gpus


def _cuda_status() -> dict[str, Any]:
    status = {"available": False, "cupy": False, "torch": False, "driver": None}
    try:
        import cupy  # noqa: F401
        status["cupy"] = True
        status["available"] = True
    except Exception:
        pass
    try:
        import torch
        if torch.cuda.is_available():
            status["torch"] = True
            status["available"] = True
    except Exception:
        pass
    if shutil.which("nvidia-smi"):
        status["available"] = True
        try:
            drv = subprocess.run(
                ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=5,
            )
            status["driver"] = drv.stdout.strip().splitlines()[0] if drv.stdout.strip() else None
        except Exception:
            pass
    return status


def detect() -> dict[str, Any]:
    logical = _logical_cpus()
    gpus = _gpus_via_pynvml()
    if gpus is None:
        gpus = _gpus_via_smi()
    cuda = _cuda_status()
    return {
        "cpu": {
            "model": _cpu_model(),
            "logical_cores": logical,
            "physical_cores": _physical_cpus(),
        },
        "memory_gb": _memory_gb(),
        "platform": f"{platform.system()} {platform.release()}",
        "gpus": gpus,
        "cuda": cuda,
        # a sensible default: leave one core for the UI; offer all GPUs
        "recommended": {
            "cpu_workers": max(1, logical - 1),
            "gpu_indices": [g["index"] for g in gpus],
        },
    }


# ---------------------------------------------------------------------------
# Compute allocation config (applied to analysis runs)
# ---------------------------------------------------------------------------


@dataclass
class ComputeConfig:
    cpu_workers: int = max(1, (_logical_cpus() - 1))
    gpu_indices: list[int] = field(default_factory=list)
    use_gpu: bool = False
    _limiter: Any = None  # threadpoolctl controller handle

    def apply(self) -> None:
        """Cap BLAS/OpenMP threads and pin the selected CUDA device(s)."""
        n = max(1, int(self.cpu_workers))
        for var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
                    "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
            os.environ[var] = str(n)
        try:
            from threadpoolctl import threadpool_limits
            # release any previous global limiter, then install a new one
            if self._limiter is not None:
                self._limiter.restore_original_limits()
            self._limiter = threadpool_limits(limits=n)
        except Exception:
            self._limiter = None
        if self.use_gpu and self.gpu_indices:
            os.environ["CUDA_VISIBLE_DEVICES"] = ",".join(str(i) for i in self.gpu_indices)

    def to_dict(self) -> dict[str, Any]:
        # build manually — the threadpoolctl handle holds ctypes pointers that
        # can't be deep-copied by dataclasses.asdict
        return {
            "cpu_workers": self.cpu_workers,
            "gpu_indices": list(self.gpu_indices),
            "use_gpu": self.use_gpu,
        }


# Process-wide singleton.
CONFIG = ComputeConfig()


def set_config(cpu_workers: int | None = None,
               gpu_indices: list[int] | None = None,
               use_gpu: bool | None = None) -> dict[str, Any]:
    info = detect()
    max_cpu = info["cpu"]["logical_cores"]
    valid_gpus = {g["index"] for g in info["gpus"]}
    if cpu_workers is not None:
        CONFIG.cpu_workers = max(1, min(int(cpu_workers), max_cpu))
    if gpu_indices is not None:
        CONFIG.gpu_indices = [i for i in gpu_indices if i in valid_gpus]
    if use_gpu is not None:
        # only honour GPU use if it's actually available
        CONFIG.use_gpu = bool(use_gpu) and info["cuda"]["available"] and bool(CONFIG.gpu_indices)
    CONFIG.apply()
    return CONFIG.to_dict()


def gpu_active() -> bool:
    """Whether GPU array maths should be attempted for this run."""
    if not (CONFIG.use_gpu and CONFIG.gpu_indices):
        return False
    try:
        import cupy  # noqa: F401
        return True
    except Exception:
        return False
