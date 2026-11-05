#!/usr/bin/env python3
"""End-to-end smoke test: ingest + train + predict the bundled sample datasets
through the same NDJSON protocol the desktop app uses."""
import json, os, subprocess, sys, tempfile, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME = os.path.join(ROOT, 'ml-engine', 'runtime', 'bin', 'python3')
SERVICE = os.path.join(ROOT, 'ml-engine', 'service')
SAMPLES = os.path.join(ROOT, 'ml-engine', 'samples')

env = dict(os.environ, PYTHONPATH=SERVICE)
proc = subprocess.Popen(
    [RUNTIME, '-u', '-B', '-m', 'ml_engine.service'],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, env=env, cwd=SERVICE,
)
results, events = {}, []
def reader():
    for line in proc.stdout:
        m = json.loads(line)
        if m.get('type') == 'result':
            results[m['id']] = m
        elif m.get('type') in ('ready', 'progress'):
            events.append(m)
threading.Thread(target=reader, daemon=True).start()

rid = [0]
def send(cmd, args):
    rid[0] += 1
    proc.stdin.write(json.dumps({'id': f'r{rid[0]}', 'cmd': cmd, 'args': args}) + '\n')
    proc.stdin.flush()
    return f'r{rid[0]}'

def expect(request_id, timeout=180):
    end = time.time() + timeout
    while time.time() < end:
        if request_id in results:
            return results[request_id]
        time.sleep(0.2)
    raise TimeoutError(request_id)

def ingest(path):
    dest = tempfile.mkstemp(suffix='.csv')[1]
    r = expect(send('ingest', {'src_path': path, 'dest_path': dest}))
    assert r['ok'], r.get('error')
    return dest

fail = None
tmpdir = tempfile.mkdtemp()
try:
    print('ingesting samples…')
    cls_csv = ingest(os.path.join(SAMPLES, 'sample_classification_gems.csv'))
    reg_csv = ingest(os.path.join(SAMPLES, 'sample_regression_prices.csv'))
    clu_csv = ingest(os.path.join(SAMPLES, 'sample_clustering_customers.csv'))

    print('training classification (auto-compare)…')
    r = expect(send('train', {
        'task': 'classification', 'dataset_path': cls_csv,
        'target': 'lab_result',
        'features': ['carat', 'colour_grade', 'clarity', 'craftsman_hours', 'cut_grade'],
        'test_size': 0.25, 'random_state': 42, 'algorithms': [],
        'n_clusters': 3, 'dbscan_min_samples': 5,
        'save_path': os.path.join(tmpdir, 'cls.joblib'),
        'meta': {'dataset': 'sample: gems'},
    }))
    assert r['ok'], r.get('error')
    print('  best:', r['result']['selected'], '→', {k: round(v, 3) if isinstance(v, float) else v for k, v in list(r['result']['selected_metrics'].items())[:6]})

    print('training regression…')
    r = expect(send('train', {
        'task': 'regression', 'dataset_path': reg_csv,
        'target': 'price_lkr',
        'features': ['weight_g', 'purity_k', 'brand_tier', 'craftsmanship_score'],
        'test_size': 0.25, 'random_state': 42, 'algorithms': [],
        'n_clusters': 3, 'dbscan_min_samples': 5,
        'save_path': os.path.join(tmpdir, 'reg.joblib'),
        'meta': {'dataset': 'sample: prices'},
    }))
    assert r['ok'], r.get('error')
    print('  best:', r['result']['selected'], '→', {k: round(v, 3) if isinstance(v, float) else v for k, v in list(r['result']['selected_metrics'].items())[:6]})

    print('training clustering (kmeans)…')
    r = expect(send('train', {
        'task': 'clustering', 'dataset_path': clu_csv,
        'target': None,
        'features': ['spend_lkr', 'visit_count', 'days_since_visit', 'avg_basket_lkr'],
        'test_size': 0.25, 'random_state': 42, 'algorithms': ['kmeans'],
        'n_clusters': 3, 'dbscan_min_samples': 5,
        'save_path': os.path.join(tmpdir, 'clu.joblib'),
        'meta': {'dataset': 'sample: customers'},
    }))
    assert r['ok'], r.get('error')
    print('  clusters:', r['result']['selected_metrics'].get('sizes'))

    print('predicting with each model…')
    for name, src in [('cls.joblib', {'type': 'rows', 'rows': [
            {'carat': 1.2, 'colour_grade': 'F', 'clarity': 'VS1', 'craftsman_hours': 4, 'cut_grade': 7},
            {'carat': 4.5, 'colour_grade': 'I', 'clarity': 'SI1', 'craftsman_hours': 1, 'cut_grade': 3}]}),
            ('reg.joblib', {'type': 'rows', 'rows': [
            {'weight_g': 12.5, 'purity_k': 22, 'brand_tier': 'premium', 'craftsmanship_score': 8.0}]}),
            ('clu.joblib', {'type': 'rows', 'rows': [
            {'spend_lkr': 42000, 'visit_count': 6, 'days_since_visit': 18, 'avg_basket_lkr': 7000}]})]:
        sha = results['r9']['result']['sha256'] if False else None
        sha_by_name = {}
        m = expect(send('predict', {'model_path': os.path.join(tmpdir, name), 'sha256': sha, 'source': src, 'model_meta': {}}))
        assert m['ok'], m.get('error')
        rows = m['result'].get('rows', [])
        keys = sorted(rows[0].keys()) if rows else []
        print(f'  {name}: {len(rows)} row(s), keys={keys}')
    print('SAMPLE SMOKE: PASS')
except Exception as exc:  # noqa: BLE001
    fail = exc
    print('SAMPLE SMOKE: FAIL —', exc)
finally:
    try:
        proc.stdin.write(json.dumps({'id': 'bye', 'cmd': 'shutdown', 'args': {}}) + '\n'); proc.stdin.flush()
        proc.wait(timeout=5)
    except Exception:
        proc.terminate()
    stderr = proc.stderr.read()
    if stderr.strip():
        print('--- engine stderr ---'); print(stderr[:4000])
    sys.exit(1 if fail else 0)
