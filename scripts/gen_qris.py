import qrcode
import base64
from io import BytesIO

qris_data = "00020101021126610016ID.CO.SHOPEE.WWW01189360091800228194190208228194190303UMI51440014ID.CO.QRIS.WWW0215ID10264932277260303UMI5204581753033605802ID5904ArSr6011PURBALINGGA61055337262070703A01630428C9"

qr = qrcode.QRCode(
    version=1,
    error_correction=qrcode.constants.ERROR_CORRECT_L,
    box_size=10,
    border=4,
)
qr.add_data(qris_data)
qr.make(fit=True)

img = qr.make_image(fill_color="black", back_color="white")
buffer = BytesIO()
img.save(buffer, format="PNG")
img_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
print(img_str)
