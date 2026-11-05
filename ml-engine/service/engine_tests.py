"""Engine test suite — run with the BUNDLED runtime, never the system Python:

    ../runtime/bin/python3 engine_tests.py

Covers: CSV loading, invalid CSV handling, missing-value preprocessing,
categorical encoding, classification / regression / clustering training,
evaluation metrics, model serialization + reload, single + batch prediction,
invalid-feature handling, and unseen categorical values at inference time.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from ml_engine.csvio import (  # noqa: E402
    EngineError,
    infer_column_type,
    load_csv,
    normalize_blank_strings,
    profile_frame,
    sniff_delimiter,
)
from ml_engine.service import handle  # noqa: E402


def noop_progress(stage, pct, msg):
    pass


class IOAndProfiling(unittest.TestCase):
    def make_csv(self, text, name="data.csv"):
        p = os.path.join(self.tmp, name)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(text)
        return p

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="vf-engine-test-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_sniff_delimiters(self):
        self.assertEqual(sniff_delimiter("a,b,c\n1,2,3\n"), ",")
        self.assertEqual(sniff_delimiter("a;b;c\n1;2;3\n"), ";")
        self.assertEqual(sniff_delimiter("a\tb\tc\n1\t2\t3\n"), "\t")

    def test_load_utf8_and_latin1(self):
        p = self.make_csv("name,city\nJosé,São Paulo\n", "latin1.csv")
        df, meta = load_csv(p)
        self.assertEqual(df.iloc[0]["name"], "José")
        p2 = self.make_csv("name,city\nJosé,São Paulo\n".encode("latin-1").decode("latin-1"), "cp.csv")
        df2, _ = load_csv(p2)
        self.assertEqual(len(df2), 1)

    def test_type_inference(self):
        s = pd.Series([1, 2, np.nan, 4, 5], name="n")
        self.assertEqual(infer_column_type(s), "numeric")
        s2 = pd.Series(["yes", "no", "yes", "no", np.nan], name="b")
        self.assertEqual(infer_column_type(s2), "boolean")
        s3 = pd.Series(["red", "blue", "red", "green", np.nan], name="c")
        self.assertEqual(infer_column_type(s3), "categorical")
        s4 = pd.Series(pd.to_datetime(["2024-01-01", "2024-06-15", np.nan]), name="d")
        self.assertEqual(infer_column_type(s4), "datetime")

    def test_blank_normalization(self):
        df = pd.DataFrame({"a": ["1", "", "3"], "b": ["x", "N/A", "z"]})
        norm = normalize_blank_strings(df)
        self.assertEqual(int(norm["a"].isna().sum()), 1)
        self.assertEqual(int(norm["b"].isna().sum()), 1)

    def test_profile_counts_missing_and_duplicates(self):
        p = self.make_csv(
            "a,b,c\n1,x,yes\n1,x,yes\n2,,no\n3,z,yes\n",
            "profile.csv",
        )
        df, _ = load_csv(p)
        df = normalize_blank_strings(df)
        prof = profile_frame(df)
        self.assertEqual(prof["row_count"], 4)
        self.assertEqual(prof["missing_total"], 1)
        self.assertEqual(prof["duplicate_rows"], 1)

    def test_invalid_csv_raises(self):
        p = self.make_csv("", "empty.csv")
        with self.assertRaises(EngineError):
            load_csv(p)

    def test_ingest_via_service(self):
        src = self.make_csv("num,cat,flag\n1,red,yes\n2,blue,no\n3,red,yes\n4,,no\n5,blue,yes\n")
        dest = os.path.join(self.tmp, "canon.csv")
        res = handle("ingest", {"src_path": src, "dest_path": dest}, noop_progress)
        self.assertEqual(res["original_rows"], 5)
        self.assertEqual(res["delimiter"], ",")
        self.assertTrue(os.path.exists(dest))
        self.assertEqual(res["profile"]["column_types"].get("numeric"), 1)
        canon, _ = load_csv(dest)
        self.assertEqual(int(canon["num"].isna().sum()), 0)


class ClassificationTraining(unittest.TestCase):
    peaks = None

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="vf-class-")
        rng = np.random.RandomState(7)
        n = 300
        df = pd.DataFrame({
            "sepal_ratio": rng.uniform(0.4, 2.0, n),
            "petal_len": rng.uniform(1, 7, n),
            "color": rng.choice(["red", "blue", "green"], n),
        })
        # a genuinely learnable target
        score = df["petal_len"] * 1.5 + (df["color"] == "blue").astype(int)
        df["species"] = np.where(score > 7, "setosa", np.where(score > 4.5, "versi", "virginica"))
        cls.path = os.path.join(cls.tmp, "iris.csv")
        df.to_csv(cls.path, index=False)
        df_w_missing = df.copy()
        df_w_missing.loc[df_w_missing.sample(frac=0.05, random_state=1).index, "petal_len"] = np.nan
        cls.path_missing = os.path.join(cls.tmp, "iris_missing.csv")
        df_w_missing.to_csv(cls.path_missing, index=False)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _train(self, path, algos, features=None):
        return handle("train", {
            "task": "classification",
            "dataset_path": path,
            "target": "species",
            "features": features if features is not None else ["sepal_ratio", "petal_len", "color"],
            "test_size": 0.25,
            "random_state": 42,
            "algorithms": algos,
            "save_path": os.path.join(self.tmp, f"model_{algos[0]}.joblib"),
            "meta": {"dataset": "iris-test"},
        }, noop_progress)

    def test_confusion_matrix_and_report(self):
        res = self._train(self.path, ["logistic_regression"])
        m = res["selected_metrics"]
        self.assertTrue(0.0 <= m["accuracy"] <= 1.0)
        self.assertGreater(m["f1_macro"], 0.5)
        self.assertEqual(len(m["confusion_matrix"]), len(m["confusion_labels"]))
        self.assertEqual(sum(sum(r) for r in m["confusion_matrix"]), res["test_rows"])
        self.assertTrue(m["classification_report"])

    def test_multiclass_roc_auc(self):
        res = self._train(self.path, ["random_forest_classifier"])
        self.assertIsNotNone(res["selected_metrics"].get("roc_auc"))

    def test_missing_value_imputation(self):
        res = self._train(self.path_missing, ["gradient_boosting_classifier"])
        self.assertGreater(res["selected_metrics"]["f1_macro"], 0.4)

    def test_bundle_roundtrip_and_predict(self):
        res = self._train(self.path, ["logistic_regression"])
        model_path = os.path.join(self.tmp, "model_logistic_regression.joblib")
        self.assertTrue(os.path.exists(model_path))
        single = handle("predict", {
            "model_path": model_path,
            "sha256": res["sha256"],
            "source": {"type": "rows", "rows": [{"sepal_ratio": 1.2, "petal_len": 5.0, "color": "blue"}]},
            "model_meta": {},
        }, noop_progress)
        self.assertEqual(single["row_count"], 1)
        self.assertIn("_prediction", single["rows"][0])
        self.assertGreaterEqual(single["rows"][0]["_confidence"], 0.0)
        # batch prediction from CSV
        batch_path = os.path.join(self.tmp, "batch.csv")
        pd.DataFrame({"sepal_ratio": [0.5, 1.9], "petal_len": [1.5, 6.5], "color": ["red", "green"]}).to_csv(batch_path, index=False)
        batch = handle("predict", {
            "model_path": model_path,
            "sha256": res["sha256"],
            "source": {"type": "csv", "path": batch_path},
            "model_meta": {},
        }, noop_progress)
        self.assertEqual(batch["row_count"], 2)
        # sha mismatch must be refused (integrity check)
        with self.assertRaises(EngineError):
            handle("predict", {
                "model_path": model_path,
                "sha256": "0" * 64,
                "source": {"type": "rows", "rows": [{"sepal_ratio": 1.0, "petal_len": 2.0, "color": "red"}]},
                "model_meta": {},
            }, noop_progress)


class RegressionTraining(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="vf-reg-")
        rng = np.random.RandomState(11)
        n = 260
        df = pd.DataFrame({
            "area": rng.uniform(40, 300, n),
            "rooms": rng.randint(1, 8, n).astype(float),
            "neighbourhood": rng.choice(["a", "b", "c"], n),
        })
        df["price"] = df["area"] * 1500 + df["rooms"] * 20_000 + (df["neighbourhood"] == "a").astype(int) * 50_000 + rng.normal(0, 10_000, n)
        cls.path = os.path.join(cls.tmp, "prices.csv")
        df.to_csv(cls.path, index=False)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(self.tmp if False else RegressionTraining.tmp, ignore_errors=True)

    def test_regression_metrics(self):
        res = handle("train", {
            "task": "regression",
            "dataset_path": self.path,
            "target": "price",
            "features": ["area", "rooms", "neighbourhood"],
            "test_size": 0.25,
            "random_state": 42,
            "algorithms": ["linear_regression", "ridge"],
            "save_path": os.path.join(self.tmp, "reg.joblib"),
            "meta": {},
        }, noop_progress)
        m = res["selected_metrics"]
        for k in ("mae", "mse", "rmse", "r2"):
            self.assertIn(k, m)
        self.assertGreater(m["r2"], 0.8)
        self.assertLess(m["rmse"], 60_000)
        self.assertIsNotNone(res["residual_std"])
        self.assertEqual(len(m["actual"]), len(m["predicted"]))

    def test_invalid_target_type_rejected(self):
        p = os.path.join(self.tmp, "bad.csv")
        pd.DataFrame({"x": [1, 2, 3, 1, 2, 3], "y": ["a", "b", "c", "a", "b", "c"]}).to_csv(p, index=False)
        with self.assertRaises(EngineError):
            handle("train", {
                "task": "regression",
                "dataset_path": p,
                "target": "y",
                "features": ["x"],
                "algorithms": ["linear_regression"],
                "save_path": os.path.join(self.tmp, "bad.joblib"),
            }, noop_progress)

    def test_target_leakage_rejected(self):
        with self.assertRaises(EngineError):
            handle("train", {
                "task": "regression",
                "dataset_path": self.path,
                "target": "price",
                "features": ["area", "rooms", "neighbourhood", "price"],
                "algorithms": ["ridge"],
                "save_path": os.path.join(self.tmp, "leak.joblib"),
            }, noop_progress)


class RegressionInference(unittest.TestCase):
    def test_regression_prediction_honest_uncertainty(self):
        tmp = tempfile.mkdtemp(prefix="vf-reginf-")
        try:
            rng = np.random.RandomState(3)
            df = pd.DataFrame({"x": rng.uniform(0, 10, 200)})
            df["y"] = df["x"] * 3 + rng.normal(0, 0.5, 200)
            path = os.path.join(tmp, "reg.csv")
            df.to_csv(path, index=False)
            res = handle("train", {
                "task": "regression", "dataset_path": path, "target": "y",
                "features": ["x"], "test_size": 0.25, "random_state": 1,
                "algorithms": ["ridge"], "save_path": os.path.join(tmp, "m.joblib"), "meta": {},
            }, noop_progress)
            pred = handle("predict", {
                "model_path": os.path.join(tmp, "m.joblib"),
                "sha256": res["sha256"],
                "source": {"type": "rows", "rows": [{"x": 4.0}, {"x": 7.5}]},
                "model_meta": {},
            }, noop_progress)
            self.assertIsNone(pred["rows"][0].get("_confidence"))
            self.assertIsNone(pred["rows"][0].get("_cluster_distance"))
            self.assertIsNotNone(pred["rows"][0]["_uncertainty"])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class Clustering(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="vf-clust-")
        rng = np.random.RandomState(5)
        n = 240
        df = pd.DataFrame({
            "x": np.concatenate([rng.normal(0, 1, n // 2), rng.normal(8, 1, n // 2)]),
            "y": np.concatenate([rng.normal(0, 1, n // 2), rng.normal(8, 1, n // 2)]),
            "cat": rng.choice(["p", "q"], n),
        })
        cls.path = os.path.join(cls.tmp, "blobs.csv")
        df.to_csv(cls.path, index=False)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_kmeans(self):
        res = handle("train", {
            "task": "clustering", "dataset_path": self.path,
            "features": ["x", "y", "cat"], "n_clusters": 2,
            "random_state": 1, "algorithms": ["kmeans"],
            "save_path": os.path.join(self.tmp, "km.joblib"), "meta": {},
        }, noop_progress)
        m = res["selected_metrics"]
        self.assertEqual(m["n_clusters"], 2)
        self.assertIsNotNone(m["silhouette"])
        self.assertGreater(m["silhouette"], 0.5)
        self.assertIsNotNone(m["inertia"])
        self.assertTrue(m["cluster_sizes"])
        self.assertTrue(m["points"])
        labels = {p["cluster"] for p in m["points"]}
        self.assertEqual(len(labels), 2)

    def test_dbscan_no_fake_metrics(self):
        res = handle("train", {
            "task": "clustering", "dataset_path": self.path,
            "features": ["x", "y", "cat"], "random_state": 1,
            "algorithms": ["dbscan"], "dbscan_eps": 2.5, "dbscan_min_samples": 4,
            "save_path": os.path.join(self.tmp, "db.joblib"), "meta": {},
        }, noop_progress)
        m = res["selected_metrics"]
        self.assertGreaterEqual(m["n_clusters"], 1)

    def test_cluster_prediction_has_distances(self):
        res = handle("train", {
            "task": "clustering", "dataset_path": self.path,
            "features": ["x", "y", "cat"], "n_clusters": 2, "random_state": 1,
            "algorithms": ["kmeans"], "save_path": os.path.join(self.tmp, "km2.joblib"), "meta": {},
        }, noop_progress)
        pred = handle("predict", {
            "model_path": os.path.join(self.tmp, "km2.joblib"),
            "sha256": res["sha256"],
            "source": {"type": "rows", "rows": [{"x": 0.1, "y": 0.2, "cat": "p"}, {"x": 7.9, "y": 8.2, "cat": "q"}]},
            "model_meta": {},
        }, noop_progress)
        row0, row1 = pred["rows"][0], pred["rows"][1]
        self.assertIsNotNone(row0["_cluster_distance"])
        self.assertEqual(int(row0["_prediction"]), 0)
        self.assertEqual(int(row1["_prediction"]), 1)


class Validation(unittest.TestCase):
    def test_missing_feature_column_rejected(self):
        tmp = tempfile.mkdtemp(prefix="vf-miss-")
        try:
            df = pd.DataFrame({"x": np.arange(60), "y": np.random.RandomState(0).uniform(0, 5, 60)})
            df["y"] = df["x"] * 2 + df["y"]
            p = os.path.join(tmp, "d.csv")
            df.to_csv(p, index=False)
            res = handle("train", {
                "task": "regression", "dataset_path": p, "target": "y",
                "features": ["x"], "algorithms": ["ridge"],
                "save_path": os.path.join(tmp, "m.joblib"),
            }, noop_progress)
            bad = os.path.join(tmp, "bad_batch.csv")
            pd.DataFrame({"not_x": [1, 2]}).to_csv(bad, index=False)
            with self.assertRaises(EngineError):
                handle("predict", {
                    "model_path": os.path.join(tmp, "m.joblib"), "sha256": res["sha256"],
                    "source": {"type": "csv", "path": bad},
                }, noop_progress)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_unseen_categorical_value_at_inference(self):
        tmp = tempfile.mkdtemp(prefix="vfs-")
        try:
            rng = np.random.RandomState(2)
            df = pd.DataFrame({"cat": rng.choice(["a", "b"], 100), "n": rng.uniform(0, 1, 100)})
            df["target"] = (df["cat"] == "a").astype(int)
            p = os.path.join(tmp, "t.csv")
            df.to_csv(p, index=False)
            res = handle("train", {
                "task": "classification", "dataset_path": p, "target": "target",
                "features": ["cat", "n"], "algorithms": ["random_forest_classifier"],
                "save_path": os.path.join(tmp, "m.joblib"),
            }, noop_progress)
            pred = handle("predict", {
                "model_path": os.path.join(tmp, "m.joblib"), "sha256": res["sha256"],
                "source": {"type": "rows", "rows": [{"cat": "purple", "n": 0.3}]},
                "model_meta": {},
            }, noop_progress)
            self.assertIn(pred["rows"][0]["_prediction"], (0, 1))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_too_small_dataset(self):
        tmp = tempfile.mkdtemp(prefix="vf-small-")
        try:
            p = os.path.join(tmp, "s.csv")
            pd.DataFrame({"x": [1, 2, 3], "y": [1, 2, 3]}).to_csv(p, index=False)
            with self.assertRaises(EngineError):
                handle("train", {
                    "task": "regression", "dataset_path": p, "target": "y",
                    "features": ["x"], "algorithms": ["ridge"],
                    "save_path": os.path.join(tmp, "m.joblib"),
                }, noop_progress)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class PreviewSearch(unittest.TestCase):
    def test_preview_sort_search_pagination(self):
        tmp = tempfile.mkdtemp(prefix="vf-prev-")
        try:
            p = os.path.join(tmp, "t.csv")
            n = 120
            pd.DataFrame({"i": np.arange(n), "s": [f"row{i}" for i in range(n)]}).to_csv(p, index=False)
            r1 = handle("preview", {"path": p, "page": 2, "page_size": 10}, noop_progress)
            self.assertEqual(r1["total"], n)
            self.assertEqual(len(r1["rows"]), 10)
            self.assertEqual(r1["rows"][0][0], 10)
            desc = handle("preview", {"path": p, "page": 1, "page_size": 5, "sort": "i", "dir": "desc"}, noop_progress)
            self.assertEqual(desc["rows"][0][0], n - 1)
            srch = handle("preview", {"path": p, "page": 1, "page_size": 500, "search": "row1"}, noop_progress)
            self.assertGreater(srch["total"], 10)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class NDJSONService(unittest.TestCase):
    """End-to-end check of the actual subprocess protocol with stdio pipes."""

    def test_service_roundtrip(self):
        tmp_ = tempfile.mkdtemp(prefix="vf-svc-")
        try:
            p = os.path.join(tmp_, "d.csv")
            pd.DataFrame({"x": np.arange(100), "y": np.arange(100) + 0.5}).to_csv(p, index=False)
            proc = subprocess.Popen(
                [sys.executable, "-u", "-B", "-m", "ml_engine.service"],
                cwd=HERE, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, text=True, env={**os.environ, "PYTHONPATH": HERE},
            )
            try:
                ready = proc.stdout.readline()
                r = json.loads(ready)
                self.assertEqual(r["type"], "ready")

                def ask(payload):
                    proc.stdin.write(json.dumps(payload) + "\n")
                    proc.stdin.flush()
                    while True:
                        line = json.loads(proc.stdout.readline())
                        if line["type"] in ("result", "error"):
                            return line
                        # progress events are fine

                r = ask({"id": 1, "cmd": "versions", "args": {}})
                self.assertTrue(r["ok"])
                for lib in ("numpy", "pandas", "scikit-learn"):
                    self.assertIn(lib, r["result"])
                r = ask({"id": 2, "cmd": "train", "args": {
                    "task": "regression", "dataset_path": p, "target": "y", "features": ["x"],
                    "algorithms": ["ridge"], "save_path": os.path.join(tmp_, "m.joblib"),
                }})
                self.assertTrue(r["ok"], r)
                r = ask({"id": 3, "cmd": "bogus_cmd", "args": {}})
                self.assertFalse(r["ok"])
            finally:
                proc.stdin.close()
                proc.wait(timeout=10)
        finally:
            shutil.rmtree(tmp_, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
