# The training environment

Fossils are trained with [MLX](https://github.com/ml-explore/mlx), which needs a native Apple silicon Python. If your Python runs under Rosetta (an Intel build of Anaconda does), MLX will not install. Beagle keeps its own environment here:

```sh
cd trainer
uv venv --python cpython-3.12-macos-aarch64-none .venv
uv pip install --python .venv/bin/python mlx numpy
.venv/bin/python -c "import platform; print(platform.machine())"   # must print arm64
```
