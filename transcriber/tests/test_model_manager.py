import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mh_transcriber.model_manager import model_repo


class ModelManagerTests(unittest.TestCase):
    def test_model_repo_maps_recommended_names(self):
        self.assertEqual(model_repo("small"), "Systran/faster-whisper-small")
        self.assertEqual(model_repo("large-v3-turbo"), "deepdml/faster-whisper-large-v3-turbo-ct2")

    def test_model_repo_allows_custom_repo_id(self):
        self.assertEqual(model_repo("owner/model"), "owner/model")


if __name__ == "__main__":
    unittest.main()
