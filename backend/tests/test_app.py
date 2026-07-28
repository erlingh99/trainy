"""The API must run without a built frontend — CI and local dev both do."""


def test_unknown_api_path_is_not_swallowed_by_the_spa_catch_all(client):
    r = client.get("/api/nope")
    assert r.status_code == 404
    assert r.json()["detail"] == "Not found"


def test_clear_404_when_the_frontend_is_not_built(client, monkeypatch, tmp_path):
    monkeypatch.setattr("app.main.FRONTEND_DIST", tmp_path)
    r = client.get("/some/spa/route")
    assert r.status_code == 404
    assert r.json()["detail"] == "Frontend not built"


def test_spa_route_serves_index_when_built(client, monkeypatch, tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html>")
    monkeypatch.setattr("app.main.FRONTEND_DIST", tmp_path)
    r = client.get("/some/spa/route")
    assert r.status_code == 200
    assert r.text == "<!doctype html>"
