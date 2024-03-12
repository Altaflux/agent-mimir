import argparse
from flask import Flask, request, jsonify, send_file
import cv2
import numpy as np
import torch
import time
import io
import json
import keras_ocr
from mobile_sam import sam_model_registry, SamAutomaticMaskGenerator


parser = argparse.ArgumentParser(
    description="Export the SAM prompt encoder and mask decoder to an ONNX model."
)

parser.add_argument(
    "--port", 
    type=int,
    required=True, 
    default=5000,
    help="The port."
)
parser.add_argument(
    "--model", 
    type=str,
    required=True, 
    help="Model path."
)


app = Flask(__name__)

@app.route('/calculate-boxes', methods=['POST'])
def calculateBoxes():


    start_time = time.time()
    file = request.files['image'].read()
    npimg = np.frombuffer(file,np.uint8)
    img = cv2.imdecode(npimg,cv2.IMREAD_COLOR)

    mask_generator = SamAutomaticMaskGenerator(mobile_sam, points_per_side=50, points_per_batch=100)
    masks = mask_generator.generate(img)
    end_time = time.time()
    execution_time = end_time - start_time
    print(f"Execution time: {execution_time:.5f} seconds")
    user_details = [{'coordinates': {'x': segment['point_coords'][0][0], 'y': segment['point_coords'][0][1] }} for i,segment in enumerate(masks)] 
    response = {
        "masks": user_details
    }
    # Return the same string back
    return jsonify(response)

#####

pipeline = keras_ocr.pipeline.Pipeline()
def midpoint(x1, y1, x2, y2):
    x_mid = int((x1 + x2)/2)
    y_mid = int((y1 + y2)/2)
    return (x_mid, y_mid)


class NumpyArrayEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        else:
            return super(NumpyArrayEncoder, self).default(obj)
    
def extract_text(img, pipeline):

    prediction_groups = pipeline.recognize([img])
    textAreas = []
    for box in prediction_groups[0]:
        x0, y0 = box[1][0]
        x1, y1 = box[1][1] 
        x2, y2 = box[1][2]
        x3, y3 = box[1][3] 
        textAreas.append({
            "text": box[0],
            "bbox": {'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2, 'x3': x3, 'y3': y3}
        })
                 
    return textAreas

@app.route('/obtainText', methods=['POST'])
def obtainText():

    file = request.files['image'].read()
    npimg = np.frombuffer(file,np.uint8)
    img = cv2.imdecode(npimg,cv2.IMREAD_UNCHANGED)
    textAreas = extract_text(img, pipeline)
    
    encodedNumpyData = json.dumps(textAreas, cls=NumpyArrayEncoder)
    decodedArrays = json.loads(encodedNumpyData)
    # Return the same string back
    return jsonify({'textBoxes': decodedArrays})

@app.route('/inpaint', methods=['POST'])
def inpaint():

    file = request.files['image'].read()
    img = cv2.imdecode(np.frombuffer(file,np.uint8), cv2.IMREAD_UNCHANGED)
   
    inpaintMaskFile = request.files['inpaintMask'].read()
    maskImg = cv2.imdecode(np.frombuffer(inpaintMaskFile,np.uint8),cv2.IMREAD_GRAYSCALE) 
    
    
    finalImage = cv2.inpaint(img, maskImg, 7, cv2.INPAINT_NS)
    finalImageBuffer = cv2.imencode('.jpg', finalImage)
    
    return send_file(
        io.BytesIO(finalImageBuffer[1]),
        download_name='inpaint.jpg',
        mimetype='image/jpg'
    )

##############
if __name__ == '__main__':
    args = parser.parse_args()

    model_type = "vit_t"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Selected device: {device}")
    global mobile_sam
    mobile_sam = sam_model_registry[model_type](checkpoint=args.model)
    mobile_sam.to(device=device)
    mobile_sam.eval()

    app.run(debug=False, port=args.port)

    
