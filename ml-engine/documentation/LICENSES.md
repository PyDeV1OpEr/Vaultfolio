# Third-party license notices

Vaultfolio's Intelligence workload redistributes the following open-source
components, bundled inside `Vaultfolio.app/Contents/Resources/ml-engine/`.
This file records which packages are included and under which license a
commercial desktop distribution may redistribute them. Full license texts
ship in the `licenses/` directory next to this file.

| Package       | Version (pinned) | License     |
|---------------|------------------|-------------|
| CPython        | 3.12.16        | Python Software Foundation License 2.0 |
| NumPy          | 2.3.4          | BSD 3-Clause |
| pandas         | 2.3.3          | BSD 3-Clause |
| scikit-learn   | 1.8.0          | BSD 3-Clause |
| SciPy          | 1.16.3         | BSD 3-Clause |
| joblib         | 1.5.2          | BSD 3-Clause |
| Rust: rusqlite | 0.37           | MIT          |
| Rust: tauri    | 2.12           | MIT / Apache-2.0 |

Sample datasets under `ml-engine/samples/` were generated for Vaultfolio from
synthetic statistical models and contain no third-party data; they are
dedicated to the public domain under CC0 1.0.

The bundled CPython build comes from python-build-standalone (astral-sh),
released under the PSF license with its install-specific notices preserved in
the runtime directory.
