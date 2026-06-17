from mh_transcriber.model_manager import model_repo


def test_model_repo_maps_recommended_names():
    assert model_repo("small") == "Systran/faster-whisper-small"
    assert model_repo("large-v3-turbo") == "deepdml/faster-whisper-large-v3-turbo-ct2"


def test_model_repo_allows_custom_repo_id():
    assert model_repo("owner/model") == "owner/model"
