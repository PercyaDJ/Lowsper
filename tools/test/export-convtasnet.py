# Étude : séparation des voix plus légère que MossFormer2 (decision.md §44). Exporte ConvTasNet
# (Asteroid, entraîné sur Libri2Mix « sep_clean » à 16 kHz, deux voix, licence CC-BY-SA 4.0) au
# format ONNX, pour le mesurer avec eval-separation.mjs dans les mêmes conditions que MossFormer2
# (ONNX Runtime Web, WebAssembly, un seul fil).
# Le fichier de poids est lu avec torch.load(weights_only=True) : tenseurs et types simples
# seulement, aucun code du fichier n'est exécuté.
# Prérequis : pip install torch asteroid onnx, puis pytorch_model.bin du dépôt
# JorisCos/ConvTasNet_Libri2Mix_sepclean_16k, révision e1ef95ab7a037950f3a606b9a56760cf94701d3d,
# dans tools/.cache/sep-convtasnet.
# Sortie : tools/.cache/sep-convtasnet/model.onnx (entrée « inputs » [1, échantillons], sorties
# « spk0 » et « spk1 », comme le modèle MossFormer2 du §39).
# Usage (depuis tools) : python test/export-convtasnet.py
import os
import torch
from asteroid.models import ConvTasNet

here = os.path.dirname(os.path.abspath(__file__))
folder = os.path.join(here, '..', '.cache', 'sep-convtasnet')
pack = torch.load(os.path.join(folder, 'pytorch_model.bin'), map_location='cpu', weights_only=True)
model = ConvTasNet(**pack['model_args'])
model.load_state_dict(pack['state_dict'])
model.eval()
print('paramètres :', sum(p.numel() for p in model.parameters()))


class Wrap(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        y = self.m(x)  # [1, 2, échantillons]
        return y[:, 0], y[:, 1]


x = torch.randn(1, 16000 * 4)
torch.onnx.export(Wrap(model), (x,), os.path.join(folder, 'model.onnx'), input_names=['inputs'],
                  output_names=['spk0', 'spk1'],
                  dynamic_axes={'inputs': {1: 'n'}, 'spk0': {1: 'n'}, 'spk1': {1: 'n'}},
                  opset_version=17, dynamo=False)
print('écrit', os.path.join(folder, 'model.onnx'))
