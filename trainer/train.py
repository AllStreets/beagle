"""Train a fossil: a small network that learns to answer like a winning agent.

Reads a dataset written by Beagle (embeddings of each news item, and the cell the teacher's
answer fell in), trains a two-layer network with MLX on this Mac, and writes the weights and a
report: loss per epoch on held-out items, accuracy, size, and time per answer.

    python train.py <dataset.npz> <out_dir> [--epochs 40]
"""
import json, sys, time, os
import numpy as np
import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim

def main(path, out, epochs=40, seed=1):
    mx.random.seed(seed); rng = np.random.default_rng(seed)
    d = json.load(open(path)) if path.endswith(".json") else np.load(path)
    X, y = np.asarray(d["x"], dtype=np.float32), np.asarray(d["y"], dtype=np.int64)
    n_cells = int(d["n_cells"])
    idx = rng.permutation(len(X)); cut = int(len(X) * .9)
    tr, va = idx[:cut], idx[cut:]
    Xtr, ytr, Xva, yva = mx.array(X[tr]), mx.array(y[tr]), mx.array(X[va]), mx.array(y[va])

    class Fossil(nn.Module):
        def __init__(s, d_in, n_out):
            super().__init__(); s.l1 = nn.Linear(d_in, 512); s.drop = nn.Dropout(.2); s.l2 = nn.Linear(512, n_out)
        def __call__(s, x): return s.l2(s.drop(nn.gelu(s.l1(x))))

    model = Fossil(X.shape[1], n_cells)
    opt = optim.AdamW(learning_rate=2e-3, weight_decay=1e-3)
    loss_fn = lambda m, x, t: nn.losses.cross_entropy(m(x), t).mean()
    step = nn.value_and_grad(model, loss_fn)
    curve, t0 = [], time.time()
    for ep in range(epochs):
        model.train(); perm = mx.array(rng.permutation(len(tr)))
        losses = []
        for i in range(0, len(tr), 128):
            b = perm[i:i + 128]; l, g = step(model, Xtr[b], ytr[b]); opt.update(model, g); mx.eval(model.parameters(), opt.state); losses.append(l.item())
        model.eval(); vl = loss_fn(model, Xva, yva).item(); acc = (mx.argmax(model(Xva), axis=1) == yva).mean().item()
        curve.append({"epoch": ep + 1, "train_loss": float(np.mean(losses)), "held_out_loss": vl, "held_out_agreement": acc})
    train_s = time.time() - t0
    os.makedirs(out, exist_ok=True)
    model.save_weights(os.path.join(out, "fossil.safetensors"))
    # time per answer, warm, one item at a time as Beagle will ask
    x1 = Xva[:1]; mx.eval(model(x1)); t1 = time.time()
    for _ in range(500): mx.eval(model(x1))
    ms = (time.time() - t1) / 500 * 1000
    size = os.path.getsize(os.path.join(out, "fossil.safetensors"))
    report = {"items": int(len(X)), "cells": n_cells, "epochs": epochs, "train_seconds": train_s, "ms_per_answer": ms, "bytes": size, "curve": curve}
    json.dump(report, open(os.path.join(out, "report.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != "curve"}))

def predict(weights, n_in, n_cells, x_path):
    """Answer a batch of embedded items: the most likely cell for each."""
    class Fossil(nn.Module):
        def __init__(s, d_in, n_out):
            super().__init__(); s.l1 = nn.Linear(d_in, 512); s.drop = nn.Dropout(.2); s.l2 = nn.Linear(512, n_out)
        def __call__(s, x): return s.l2(s.drop(nn.gelu(s.l1(x))))
    m = Fossil(n_in, n_cells); m.load_weights(weights); m.eval()
    d = json.load(open(x_path)) if x_path.endswith(".json") else np.load(x_path)
    X = mx.array(np.asarray(d["x"], dtype=np.float32))
    t = time.time(); out = mx.argmax(m(X), axis=1); mx.eval(out)
    print(json.dumps({"cells": np.array(out).tolist(), "ms_total": (time.time() - t) * 1000}))

if __name__ == "__main__":
    if sys.argv[1] == "predict": predict(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5])
    else:
        ep = int(sys.argv[sys.argv.index("--epochs") + 1]) if "--epochs" in sys.argv else 40
        main(sys.argv[1], sys.argv[2], ep)
