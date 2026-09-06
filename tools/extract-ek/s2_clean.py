import pymupdf
SRC="/Users/heeeione/Downloads/[실기] [전기요괴] 전기기사 단답형_260831_125805.pdf"
OUT="clean.pdf"
d=pymupdf.open(SRC)
n=0
for p in d:
    for im in p.get_images(full=True):
        if im[0]==16:
            p.delete_image(16); n+=1
d.save(OUT, garbage=3, deflate=True)
print("deleted watermark refs on", n, "pages ->", OUT)
d2=pymupdf.open(OUT)
print("check page1 images:", [(x[0],x[2],x[3]) for x in d2[1].get_images(full=True)])
